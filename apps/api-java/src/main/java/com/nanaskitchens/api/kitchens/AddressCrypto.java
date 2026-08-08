package com.nanaskitchens.api.kitchens;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * NFR5: home addresses are encrypted at the application layer with AES-256-GCM.
 * Wire format is identical to packages/core/src/crypto.ts (base64(iv).base64(tag).base64(data),
 * 12-byte IV, 16-byte tag, key = the first 32 utf8 bytes of ADDRESS_ENC_KEY) so both backends
 * can read each other's ciphertexts in the shared database. Both sides now REQUIRE at least
 * 32 characters instead of zero-padding a short key; keep the two implementations in step.
 */
@Component
public class AddressCrypto {

    private static final int IV_LENGTH = 12;
    private static final int TAG_LENGTH_BYTES = 16;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final SecretKeySpec key;

    public AddressCrypto(@Value("${app.address-enc-key}") String rawKey) {
        // Reject instead of padding. Zero-padding turned a blank ADDRESS_ENC_KEY into a key of
        // 32 '0' bytes, so setting the variable to an empty string produced silent, effectively
        // public encryption - and that also slipped past removing the config default, since
        // Spring resolves an empty variable to "". JwtService already rejects short keys.
        if (rawKey == null || rawKey.isBlank() || rawKey.length() < 32) {
            throw new IllegalStateException(
                    "ADDRESS_ENC_KEY must be at least 32 characters (AES-256); got "
                            + (rawKey == null ? "null" : rawKey.length()));
        }
        this.key = new SecretKeySpec(
                rawKey.substring(0, 32).getBytes(StandardCharsets.UTF_8), "AES");
    }

    public String encrypt(String plain) {
        try {
            byte[] iv = new byte[IV_LENGTH];
            SECURE_RANDOM.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_LENGTH_BYTES * 8, iv));
            byte[] out = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            // JCA appends the tag to the ciphertext; the Node format keeps them separate.
            byte[] data = Arrays.copyOfRange(out, 0, out.length - TAG_LENGTH_BYTES);
            byte[] tag = Arrays.copyOfRange(out, out.length - TAG_LENGTH_BYTES, out.length);
            Base64.Encoder b64 = Base64.getEncoder();
            return b64.encodeToString(iv) + "." + b64.encodeToString(tag) + "." + b64.encodeToString(data);
        } catch (Exception e) {
            throw new IllegalStateException("ADDRESS_ENCRYPT_FAILED", e);
        }
    }

    public String decrypt(String payload) {
        try {
            String[] parts = payload.split("\\.");
            Base64.Decoder b64 = Base64.getDecoder();
            byte[] iv = b64.decode(parts[0]);
            byte[] tag = b64.decode(parts[1]);
            byte[] data = b64.decode(parts[2]);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_LENGTH_BYTES * 8, iv));
            byte[] combined = new byte[data.length + tag.length];
            System.arraycopy(data, 0, combined, 0, data.length);
            System.arraycopy(tag, 0, combined, data.length, tag.length);
            return new String(cipher.doFinal(combined), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("ADDRESS_DECRYPT_FAILED", e);
        }
    }
}
