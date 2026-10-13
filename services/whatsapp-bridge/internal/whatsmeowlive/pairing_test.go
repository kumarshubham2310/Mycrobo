package whatsmeowlive

import (
	"context"
	"errors"
	"testing"
)

func TestNormalizePairingPhone(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "international digits", input: "+918511092626", want: "918511092626"},
		{name: "display punctuation", input: "+44 (7700) 900-123", want: "447700900123"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := NormalizePairingPhone(test.input)
			if err != nil {
				t.Fatalf("NormalizePairingPhone() error = %v", err)
			}
			if got != test.want {
				t.Fatalf("NormalizePairingPhone() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestNormalizePairingPhoneRejectsUnsafeOrNationalValues(t *testing.T) {
	t.Parallel()
	for _, input := range []string{"", "+", "+91ABC8511092626", "08511092626", "+123", "+1234567890123456", "+９１８５１１０９２６２６", "+91 85110 ext 9"} {
		if _, err := NormalizePairingPhone(input); err == nil {
			t.Fatalf("NormalizePairingPhone(%q) unexpectedly succeeded", input)
		}
	}
}

func TestPairingFailureClassifiesRecoveryWithoutLeakingProviderDetails(t *testing.T) {
	t.Parallel()
	tests := []struct {
		err       error
		code      string
		retryable bool
	}{
		{err: context.DeadlineExceeded, code: "provider-timeout", retryable: true},
		{err: errors.New("HTTP 429 too many attempts for secret-account"), code: "rate-limited", retryable: true},
		{err: errors.New("client-outdated build=private"), code: "client-outdated", retryable: false},
		{err: errors.New("network socket EOF private-host"), code: "network-unavailable", retryable: true},
	}
	for _, test := range tests {
		snapshot := pairingFailure(test.err)
		if snapshot.FailureCode != test.code || snapshot.Retryable != test.retryable {
			t.Fatalf("pairingFailure(%v) = %#v", test.err, snapshot)
		}
		if snapshot.Error == "" || snapshot.Error == test.err.Error() {
			t.Fatalf("pairingFailure exposed or omitted provider details: %#v", snapshot)
		}
	}
}

func TestPairingPhoneMaskNeverEchoesTheCompleteNumber(t *testing.T) {
	t.Parallel()
	if got := maskedPairingPhone("918511092626"); got != "•••• 2626" {
		t.Fatalf("maskedPairingPhone() = %q", got)
	}
}
