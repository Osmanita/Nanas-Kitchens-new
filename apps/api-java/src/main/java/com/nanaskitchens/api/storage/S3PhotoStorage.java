package com.nanaskitchens.api.storage;

import java.net.URI;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

/**
 * S3-backed photo storage (STORAGE_PROVIDER=s3). Fargate's filesystem is per-task and
 * ephemeral, so a photo uploaded to one task is invisible to the next and gone at the next
 * deploy — this is what has to exist before more than one task can run.
 *
 * <p>store() returns {@code {public-base-url}/files/{name}}, the same shape LocalPhotoStorage
 * returns, because that string is written into the database. It deliberately does NOT return a
 * presigned url: those expire, and a presigned url persisted in a row is a photo that works in
 * testing and 404s a week later. {@link S3FilesController} presigns at read time behind that
 * stable url instead, so the bucket stays private and nothing in the database ever goes stale.
 *
 * <p>Credentials come from the default provider chain (ECS task role in the deployed setup,
 * so no keys anywhere) unless an explicit access key is configured, which is how a local
 * MinIO is pointed at.
 */
@Component
@ConditionalOnProperty(name = "app.storage.provider", havingValue = "s3")
public class S3PhotoStorage implements PhotoStorage {

    private final S3Client s3;
    private final S3Presigner presigner;
    private final String bucket;
    private final String keyPrefix;
    private final String publicBaseUrl;
    private final Duration signedUrlTtl;

    public S3PhotoStorage(
            @Value("${app.storage.s3.bucket}") String bucket,
            @Value("${app.storage.s3.region:us-east-2}") String region,
            // Set for MinIO/LocalStack; empty means real AWS.
            @Value("${app.storage.s3.endpoint:}") String endpoint,
            @Value("${app.storage.s3.access-key:}") String accessKey,
            @Value("${app.storage.s3.secret-key:}") String secretKey,
            @Value("${app.storage.s3.key-prefix:photos/}") String keyPrefix,
            @Value("${app.storage.s3.signed-url-ttl-minutes:60}") long signedUrlTtlMinutes,
            @Value("${app.storage.public-base-url:http://localhost:8080}") String publicBaseUrl) {
        this.bucket = bucket;
        this.keyPrefix = keyPrefix;
        this.publicBaseUrl = publicBaseUrl;
        this.signedUrlTtl = Duration.ofMinutes(signedUrlTtlMinutes);

        var credentials = accessKey.isBlank()
                ? DefaultCredentialsProvider.create()
                : StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKey, secretKey));
        // Path-style addressing when an endpoint is set: MinIO does not do virtual-host
        // buckets, and "bucket.localhost" does not resolve anywhere.
        var serviceConfig = S3Configuration.builder()
                .pathStyleAccessEnabled(!endpoint.isBlank())
                .build();

        var clientBuilder = S3Client.builder()
                .region(Region.of(region))
                .credentialsProvider(credentials)
                .serviceConfiguration(serviceConfig)
                .httpClient(UrlConnectionHttpClient.create());
        var presignerBuilder = S3Presigner.builder()
                .region(Region.of(region))
                .credentialsProvider(credentials)
                .serviceConfiguration(serviceConfig);
        if (!endpoint.isBlank()) {
            clientBuilder.endpointOverride(URI.create(endpoint));
            presignerBuilder.endpointOverride(URI.create(endpoint));
        }
        this.s3 = clientBuilder.build();
        this.presigner = presignerBuilder.build();
    }

    @Override
    public String store(byte[] bytes, String contentType) {
        String name = PhotoStorage.newName(contentType);
        s3.putObject(
                PutObjectRequest.builder()
                        .bucket(bucket)
                        .key(keyPrefix + name)
                        .contentType(contentType)
                        .build(),
                RequestBody.fromBytes(bytes));
        return publicBaseUrl + "/files/" + name;
    }

    /** Short-lived GET url for one stored object; generated per request, never persisted. */
    String presignedUrl(String name) {
        return presigner.presignGetObject(GetObjectPresignRequest.builder()
                        .signatureDuration(signedUrlTtl)
                        .getObjectRequest(GetObjectRequest.builder()
                                .bucket(bucket)
                                .key(keyPrefix + name)
                                .build())
                        .build())
                .url()
                .toString();
    }
}
