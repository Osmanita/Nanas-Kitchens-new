package com.nanaskitchens.api.storage;

import static org.assertj.core.api.Assertions.assertThat;

import com.nanaskitchens.api.support.IntegrationTest;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.BucketAlreadyOwnedByYouException;
import software.amazon.awssdk.services.s3.model.CreateBucketRequest;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;

/**
 * S3 storage against a real S3 API (MinIO), because the parts most likely to be wrong are
 * exactly the parts a mock cannot have an opinion about: path-style addressing, whether the
 * presigned signature actually validates, and whether the object is really there afterwards.
 *
 * <p>Gated on TEST_S3_ENDPOINT rather than skipped by catching a connection error — a test
 * that quietly passes when its dependency is missing is worse than no test. CI always sets it
 * (see ci.yml); locally, {@code docker compose --profile s3 up -d} and then
 * {@code $env:TEST_S3_ENDPOINT = "http://localhost:9000"}.
 *
 * <p>What this does NOT prove: that it works against real AWS S3. No AWS account exists yet.
 * MinIO is API-compatible and this covers the wiring, but IAM, bucket policy and region
 * behaviour are untested.
 */
@EnabledIfEnvironmentVariable(named = "TEST_S3_ENDPOINT", matches = ".+")
@SpringBootTest(
        properties = {
            "app.storage.provider=s3",
            "app.storage.s3.bucket=" + S3PhotoStorageIntegrationTest.BUCKET,
            "app.storage.s3.key-prefix=photos/",
            "app.storage.public-base-url=http://localhost:8080"
        })
class S3PhotoStorageIntegrationTest extends IntegrationTest {

    static final String BUCKET = "nanas-test-photos";

    private static final String ACCESS_KEY = envOr("TEST_S3_ACCESS_KEY", "minioadmin");
    private static final String SECRET_KEY = envOr("TEST_S3_SECRET_KEY", "minioadmin");

    private static final byte[] PNG_BYTES = "not really a png, but the bytes must round-trip"
            .getBytes(StandardCharsets.UTF_8);

    @Autowired
    private PhotoStorage storage;

    @Autowired
    private S3FilesController filesController;

    private static String envOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static String endpoint() {
        return System.getenv("TEST_S3_ENDPOINT");
    }

    private static S3Client client() {
        return S3Client.builder()
                .region(Region.US_EAST_1)
                .endpointOverride(URI.create(endpoint()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(ACCESS_KEY, SECRET_KEY)))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .httpClient(UrlConnectionHttpClient.create())
                .build();
    }

    @DynamicPropertySource
    static void s3Properties(DynamicPropertyRegistry registry) {
        registry.add("app.storage.s3.endpoint", S3PhotoStorageIntegrationTest::endpoint);
        registry.add("app.storage.s3.access-key", () -> ACCESS_KEY);
        registry.add("app.storage.s3.secret-key", () -> SECRET_KEY);
        registry.add("app.storage.s3.region", () -> "us-east-1");
    }

    @BeforeAll
    static void createBucket() {
        if (endpoint() == null || endpoint().isBlank()) {
            return; // the class-level condition already disabled us; do not touch the network
        }
        try (S3Client s3 = client()) {
            try {
                s3.createBucket(CreateBucketRequest.builder().bucket(BUCKET).build());
            } catch (BucketAlreadyOwnedByYouException e) {
                // Left over from a previous run — fine, the tests use fresh keys each time.
            }
        }
    }

    private static byte[] fetch(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) URI.create(url).toURL().openConnection();
        connection.setInstanceFollowRedirects(false);
        try (InputStream in = connection.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            in.transferTo(out);
            return out.toByteArray();
        } finally {
            connection.disconnect();
        }
    }

    @Test
    void storeReturnsAStableUrlAndPutsTheObjectInTheBucket() {
        String url = storage.store(PNG_BYTES, "image/png");

        // The URL that gets written to the database. It must be the provider-independent shape:
        // a presigned URL here would work today and 404 from a database row next week.
        assertThat(url).startsWith("http://localhost:8080/files/");
        assertThat(url).endsWith(".png");
        assertThat(url).doesNotContain("X-Amz-Signature").doesNotContain("Expires");

        String name = url.substring(url.lastIndexOf('/') + 1);
        try (S3Client s3 = client()) {
            var keys = s3.listObjectsV2(ListObjectsV2Request.builder()
                            .bucket(BUCKET)
                            .prefix("photos/")
                            .build())
                    .contents().stream().map(o -> o.key()).toList();
            assertThat(keys).contains("photos/" + name);
        }
    }

    @Test
    void theStableUrlRedirectsToAPresignedUrlThatActuallyServesTheBytes() throws Exception {
        String url = storage.store(PNG_BYTES, "image/png");
        String name = url.substring(url.lastIndexOf('/') + 1);

        ResponseEntity<Void> response = filesController.serve(name);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FOUND);
        URL location = response.getHeaders().getLocation().toURL();
        assertThat(location.getQuery()).contains("X-Amz-Signature");

        // The signature has to be valid, not merely present: fetch it and compare the bytes.
        assertThat(fetch(location.toString())).isEqualTo(PNG_BYTES);
    }

    @Test
    void aNameThatIsNotOneOfOursIsRejectedBeforeAnythingIsSigned() {
        // Without this guard the path segment would be signed straight into a URL for whatever
        // key it names, turning the redirect into a read primitive for the whole bucket.
        for (String bad : new String[] {"../secrets.json", "photos/other.png", "evil.png", ".."}) {
            assertThat(
                            org.assertj.core.api.Assertions.catchThrowable(
                                    () -> filesController.serve(bad)))
                    .as("name %s", bad)
                    .isNotNull();
        }
    }
}
