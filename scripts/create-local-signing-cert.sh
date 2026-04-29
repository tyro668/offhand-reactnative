#!/usr/bin/env bash
#
# Create a long-lived self-signed code-signing certificate named
# "OffhandLocalDev" in the current user's login keychain. The macOS
# project is configured to sign with this identity, so once the cert
# exists, every `npm run macos` rebuild produces a binary with the
# SAME Designated Requirement → macOS TCC keeps the previously granted
# Accessibility / Input Monitoring / Microphone permissions.
#
# Run this ONCE on each developer machine. Safe to re-run; it skips
# creation if a cert with the same name already exists.

set -euo pipefail

CERT_NAME="Offhand Local Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning | grep -q "\"$CERT_NAME\""; then
  echo "Codesign identity \"$CERT_NAME\" already exists. Nothing to do."
  exit 0
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Build the certificate template.
cat >"$TMPDIR/cert.cnf" <<EOF
[ req ]
distinguished_name = req_distinguished_name
prompt = no
x509_extensions = v3_ext

[ req_distinguished_name ]
CN = $CERT_NAME

[ v3_ext ]
basicConstraints = critical,CA:false
keyUsage         = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$TMPDIR/key.pem" \
  -out    "$TMPDIR/cert.pem" \
  -days 3650 \
  -config "$TMPDIR/cert.cnf" >/dev/null 2>&1

# Bundle key + cert as PKCS#12 (passwordless) and import.
# `-legacy` forces OpenSSL 3 to use RC2/3DES + SHA1 MAC, which is what
# macOS `security import` understands. Without it the import fails with
# "MAC verification failed during PKCS12 import".
openssl pkcs12 -export -legacy \
  -inkey "$TMPDIR/key.pem" \
  -in    "$TMPDIR/cert.pem" \
  -name  "$CERT_NAME" \
  -out   "$TMPDIR/cert.p12" \
  -passout pass: >/dev/null 2>&1

security import "$TMPDIR/cert.p12" -k "$KEYCHAIN" -P "" -T /usr/bin/codesign

# Allow codesign to use the private key without prompting.
security set-key-partition-list -S apple-tool:,apple: -s -k "" "$KEYCHAIN" >/dev/null 2>&1 || true

echo "Created code-signing identity \"$CERT_NAME\" in $KEYCHAIN."
echo
echo "Next steps:"
echo "  1. Run \`npm run macos\` once and grant Accessibility / Input Monitoring / Microphone."
echo "  2. Subsequent rebuilds will reuse the same Designated Requirement, so permissions persist."
