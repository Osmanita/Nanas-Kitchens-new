package com.nanaskitchens.api.kitchens;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** NFR5 — addresses are AES-256-GCM encrypted at rest; wire format is shared with the
 * NestJS service (packages/core/src/crypto.ts), so a round trip here is what actually matters. */
class AddressCryptoTest {

    @Test
    void roundTripsPlainTextThroughEncryptAndDecrypt() {
        AddressCrypto crypto = new AddressCrypto("32-byte-hex-key-change-me-0000000000");
        String address = "47 N Liberty St, Powell, OH";

        String encrypted = crypto.encrypt(address);

        assertThat(encrypted).isNotEqualTo(address);
        assertThat(crypto.decrypt(encrypted)).isEqualTo(address);
    }

    @Test
    void sameInputEncryptsDifferentlyEachTime() {
        // Random IV per call — ciphertext must never repeat even for identical plaintext.
        AddressCrypto crypto = new AddressCrypto("32-byte-hex-key-change-me-0000000000");
        String address = "89 S Liberty St, Powell, OH";

        assertThat(crypto.encrypt(address)).isNotEqualTo(crypto.encrypt(address));
    }

    @Test
    void keyShorterThan32BytesIsPaddedSoItStillWorks() {
        // Constructor pads short keys with '0' rather than rejecting them (see ADDRESS_ENC_KEY
        // default in .env.example) — verify that path actually round-trips too.
        AddressCrypto crypto = new AddressCrypto("short-key");
        String encrypted = crypto.encrypt("210 W Olentangy St, Powell, OH");
        assertThat(crypto.decrypt(encrypted)).isEqualTo("210 W Olentangy St, Powell, OH");
    }

    @Test
    void decryptingWithTheWrongKeyFails() {
        AddressCrypto a = new AddressCrypto("32-byte-hex-key-change-me-0000000000");
        AddressCrypto b = new AddressCrypto("a-totally-different-encryption-key-here");

        String encrypted = a.encrypt("550 Home Rd, Powell, OH");

        assertThatThrownBy(() -> b.decrypt(encrypted)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void tamperedCiphertextFailsGcmAuthentication() {
        AddressCrypto crypto = new AddressCrypto("32-byte-hex-key-change-me-0000000000");
        String encrypted = crypto.encrypt("3200 Sawmill Pkwy, Powell, OH");
        String[] parts = encrypted.split("\\.");
        // Flip a character in the ciphertext body — GCM's auth tag must catch this.
        String tamperedData = (parts[2].charAt(0) == 'A' ? 'B' : 'A') + parts[2].substring(1);
        String tampered = parts[0] + "." + parts[1] + "." + tamperedData;

        assertThatThrownBy(() -> crypto.decrypt(tampered)).isInstanceOf(IllegalStateException.class);
    }
}
