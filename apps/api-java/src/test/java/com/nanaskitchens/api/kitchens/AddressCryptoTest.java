package com.nanaskitchens.api.kitchens;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** NFR5 — addresses are AES-256-GCM encrypted at rest; wire format is shared with the
 * NestJS service (packages/core/src/crypto.ts), so a round trip here is what actually matters. */
class AddressCryptoTest {

    /**
     * Test-only key material. It used to be the literal that shipped in .env.example and is now
     * published in the repo history, which made it indistinguishable at a glance from a real
     * key still in use somewhere — the name and the value both say otherwise now. Any 32+ byte
     * string works here; nothing about these tests depends on which one.
     */
    private static final String FIXTURE_KEY = "address-crypto-unit-test-fixture-key-not-a-secret";

    @Test
    void roundTripsPlainTextThroughEncryptAndDecrypt() {
        AddressCrypto crypto = new AddressCrypto(FIXTURE_KEY);
        String address = "47 N Liberty St, Powell, OH";

        String encrypted = crypto.encrypt(address);

        assertThat(encrypted).isNotEqualTo(address);
        assertThat(crypto.decrypt(encrypted)).isEqualTo(address);
    }

    @Test
    void sameInputEncryptsDifferentlyEachTime() {
        // Random IV per call — ciphertext must never repeat even for identical plaintext.
        AddressCrypto crypto = new AddressCrypto(FIXTURE_KEY);
        String address = "89 S Liberty St, Powell, OH";

        assertThat(crypto.encrypt(address)).isNotEqualTo(crypto.encrypt(address));
    }

    @Test
    void keyShorterThan32BytesIsRejected() {
        // Used to zero-pad short keys, which meant a blank ADDRESS_ENC_KEY silently became a
        // key of 32 '0' bytes. Reject instead, matching JwtService.
        assertThatThrownBy(() -> new AddressCrypto("short-key"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("at least 32");
    }

    @Test
    void blankKeyIsRejected() {
        // Spring resolves a set-but-empty ADDRESS_ENC_KEY to "", so removing the config
        // default is not enough on its own.
        assertThatThrownBy(() -> new AddressCrypto("")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new AddressCrypto("   ")).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void decryptingWithTheWrongKeyFails() {
        AddressCrypto a = new AddressCrypto(FIXTURE_KEY);
        AddressCrypto b = new AddressCrypto("a-totally-different-encryption-key-here");

        String encrypted = a.encrypt("550 Home Rd, Powell, OH");

        assertThatThrownBy(() -> b.decrypt(encrypted)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void tamperedCiphertextFailsGcmAuthentication() {
        AddressCrypto crypto = new AddressCrypto(FIXTURE_KEY);
        String encrypted = crypto.encrypt("3200 Sawmill Pkwy, Powell, OH");
        String[] parts = encrypted.split("\\.");
        // Flip a character in the ciphertext body — GCM's auth tag must catch this.
        String tamperedData = (parts[2].charAt(0) == 'A' ? 'B' : 'A') + parts[2].substring(1);
        String tampered = parts[0] + "." + parts[1] + "." + tamperedData;

        assertThatThrownBy(() -> crypto.decrypt(tampered)).isInstanceOf(IllegalStateException.class);
    }
}
