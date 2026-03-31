use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use ring::signature::{self, UnparsedPublicKey};
use serde::{Deserialize, Serialize};

use crate::secrets::EntitlementCacheMetadata;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EntitlementState {
    Active,
    Grace,
    Restricted,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementEvaluation {
    pub state: EntitlementState,
    pub code: String,
    pub trusted_time_unix_ms: u64,
    pub cache: Option<EntitlementCacheMetadata>,
    pub cache_updated: bool,
}

#[derive(Debug, Clone)]
pub struct EntitlementVerifierPolicy {
    pub expected_issuer: String,
    pub expected_audience: String,
    pub grace_period_ms: u64,
}

impl EntitlementVerifierPolicy {
    pub fn from_env() -> Self {
        let expected_issuer = std::env::var("OPENPCB_ENTITLEMENT_ISSUER")
            .ok()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "openpcb-license-service".to_string());
        let expected_audience = std::env::var("OPENPCB_ENTITLEMENT_AUDIENCE")
            .ok()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "openpcb-desktop".to_string());
        let grace_period_ms = std::env::var("OPENPCB_ENTITLEMENT_GRACE_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(7 * 24 * 60 * 60 * 1000);

        Self {
            expected_issuer,
            expected_audience,
            grace_period_ms,
        }
    }
}

#[derive(Debug, Clone)]
pub struct EntitlementVerifier {
    pub policy: EntitlementVerifierPolicy,
    pub public_keys: HashMap<String, Vec<u8>>,
}

#[derive(Debug, Clone, Deserialize)]
struct JwtHeader {
    alg: String,
    kid: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EntitlementClaims {
    iss: String,
    aud: String,
    sub: String,
    jti: String,
    iat: u64,
    nbf: u64,
    exp: u64,
    schema_version: u64,
    account_id: String,
    device_id: String,
    license_id: String,
    access_status: String,
    license_status: String,
    #[serde(default)]
    license_tier: String,
}

#[derive(Debug, Clone)]
enum VerifyError {
    InvalidTokenFormat,
    InvalidHeader,
    InvalidAlg,
    MissingKid,
    UnknownKid,
    InvalidSignature,
    InvalidClaims,
    InvalidIssuer,
    InvalidAudience,
    TokenNotActive,
    TokenExpired,
}

impl VerifyError {
    fn code(&self) -> &'static str {
        match self {
            VerifyError::InvalidTokenFormat => "INVALID_TOKEN_FORMAT",
            VerifyError::InvalidHeader => "INVALID_HEADER",
            VerifyError::InvalidAlg => "INVALID_ALG",
            VerifyError::MissingKid => "MISSING_KID",
            VerifyError::UnknownKid => "UNKNOWN_KID",
            VerifyError::InvalidSignature => "INVALID_SIGNATURE",
            VerifyError::InvalidClaims => "INVALID_CLAIMS",
            VerifyError::InvalidIssuer => "INVALID_ISSUER",
            VerifyError::InvalidAudience => "INVALID_AUDIENCE",
            VerifyError::TokenNotActive => "TOKEN_NOT_ACTIVE",
            VerifyError::TokenExpired => "TOKEN_EXPIRED",
        }
    }
}

pub fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn decode_base64_url(value: &str) -> Result<Vec<u8>, VerifyError> {
    if value.is_empty() {
        return Err(VerifyError::InvalidTokenFormat);
    }

    let mut normalized = value.replace('-', "+").replace('_', "/");
    let padding = (4 - (normalized.len() % 4)) % 4;
    if padding > 0 {
        normalized.push_str(&"=".repeat(padding));
    }

    let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut rev = [255u8; 256];
    for (idx, ch) in table.iter().enumerate() {
        rev[*ch as usize] = idx as u8;
    }

    let bytes = normalized.as_bytes();
    if bytes.len() % 4 != 0 {
        return Err(VerifyError::InvalidTokenFormat);
    }

    let mut out = Vec::with_capacity((bytes.len() / 4) * 3);
    for chunk in bytes.chunks(4) {
        let a = chunk[0];
        let b = chunk[1];
        let c = chunk[2];
        let d = chunk[3];

        let av = *rev.get(a as usize).ok_or(VerifyError::InvalidTokenFormat)?;
        let bv = *rev.get(b as usize).ok_or(VerifyError::InvalidTokenFormat)?;
        if av == 255 || bv == 255 {
            return Err(VerifyError::InvalidTokenFormat);
        }

        let cv = if c == b'=' {
            64
        } else {
            let v = *rev.get(c as usize).ok_or(VerifyError::InvalidTokenFormat)?;
            if v == 255 {
                return Err(VerifyError::InvalidTokenFormat);
            }
            v
        };
        let dv = if d == b'=' {
            64
        } else {
            let v = *rev.get(d as usize).ok_or(VerifyError::InvalidTokenFormat)?;
            if v == 255 {
                return Err(VerifyError::InvalidTokenFormat);
            }
            v
        };

        out.push((av << 2) | (bv >> 4));
        if cv != 64 {
            out.push(((bv & 0x0f) << 4) | (cv >> 2));
        }
        if dv != 64 {
            out.push(((cv & 0x03) << 6) | dv);
        }
    }

    Ok(out)
}

#[cfg(test)]
fn encode_base64_url(value: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut out = String::new();
    let mut i = 0usize;
    while i + 3 <= value.len() {
        let a = value[i];
        let b = value[i + 1];
        let c = value[i + 2];
        out.push(TABLE[(a >> 2) as usize] as char);
        out.push(TABLE[((a & 0x03) << 4 | (b >> 4)) as usize] as char);
        out.push(TABLE[((b & 0x0f) << 2 | (c >> 6)) as usize] as char);
        out.push(TABLE[(c & 0x3f) as usize] as char);
        i += 3;
    }

    let rem = value.len() - i;
    if rem == 1 {
        let a = value[i];
        out.push(TABLE[(a >> 2) as usize] as char);
        out.push(TABLE[((a & 0x03) << 4) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem == 2 {
        let a = value[i];
        let b = value[i + 1];
        out.push(TABLE[(a >> 2) as usize] as char);
        out.push(TABLE[((a & 0x03) << 4 | (b >> 4)) as usize] as char);
        out.push(TABLE[((b & 0x0f) << 2) as usize] as char);
        out.push('=');
    }

    out.replace('+', "-")
        .replace('/', "_")
        .trim_end_matches('=')
        .to_string()
}

// In release builds, the Ed25519 public key is embedded at compile time.
// Replace src-tauri/keys/entitlement-verify.pub with the real 32-byte raw key before shipping.
#[cfg(not(debug_assertions))]
const EMBEDDED_PUBLIC_KEY: &[u8] = include_bytes!("../keys/entitlement-verify.pub");

impl EntitlementVerifier {
    pub fn from_env() -> Self {
        let policy = EntitlementVerifierPolicy::from_env();
        #[allow(unused_mut)]
        let mut public_keys = std::env::var("OPENPCB_ENTITLEMENT_PUBLIC_KEYS")
            .ok()
            .and_then(|raw| serde_json::from_str::<HashMap<String, String>>(&raw).ok())
            .map(|raw_map| {
                raw_map
                    .into_iter()
                    .filter_map(|(kid, value)| {
                        decode_base64_url(&value).ok().map(|bytes| (kid, bytes))
                    })
                    .collect::<HashMap<String, Vec<u8>>>()
            })
            .unwrap_or_default();

        #[cfg(not(debug_assertions))]
        {
            public_keys
                .entry("embedded-v1".to_string())
                .or_insert_with(|| EMBEDDED_PUBLIC_KEY.to_vec());
        }

        Self {
            policy,
            public_keys,
        }
    }

    fn verify_jws(
        &self,
        token: &str,
        now_unix_ms: u64,
        enforce_temporal_checks: bool,
    ) -> Result<EntitlementClaims, VerifyError> {
        let mut parts = token.split('.');
        let header_part = parts.next().ok_or(VerifyError::InvalidTokenFormat)?;
        let payload_part = parts.next().ok_or(VerifyError::InvalidTokenFormat)?;
        let signature_part = parts.next().ok_or(VerifyError::InvalidTokenFormat)?;
        if parts.next().is_some()
            || header_part.is_empty()
            || payload_part.is_empty()
            || signature_part.is_empty()
        {
            return Err(VerifyError::InvalidTokenFormat);
        }

        let header_bytes = decode_base64_url(header_part)?;
        let payload_bytes = decode_base64_url(payload_part)?;
        let signature = decode_base64_url(signature_part)?;

        let header: JwtHeader =
            serde_json::from_slice(&header_bytes).map_err(|_| VerifyError::InvalidHeader)?;
        if header.alg != "EdDSA" {
            return Err(VerifyError::InvalidAlg);
        }
        if header.kid.is_empty() {
            return Err(VerifyError::MissingKid);
        }

        let claims: EntitlementClaims =
            serde_json::from_slice(&payload_bytes).map_err(|_| VerifyError::InvalidClaims)?;

        let key = self
            .public_keys
            .get(&header.kid)
            .ok_or(VerifyError::UnknownKid)?;
        let verifier = UnparsedPublicKey::new(&signature::ED25519, key);
        let signing_input = format!("{header_part}.{payload_part}");
        verifier
            .verify(signing_input.as_bytes(), &signature)
            .map_err(|_| VerifyError::InvalidSignature)?;

        if claims.iss != self.policy.expected_issuer {
            return Err(VerifyError::InvalidIssuer);
        }
        if claims.aud != self.policy.expected_audience {
            return Err(VerifyError::InvalidAudience);
        }

        if enforce_temporal_checks {
            let now_sec = now_unix_ms / 1000;
            if now_sec < claims.nbf {
                return Err(VerifyError::TokenNotActive);
            }
            if now_sec >= claims.exp {
                return Err(VerifyError::TokenExpired);
            }
        }

        Ok(claims)
    }

    fn claims_from_cache(
        &self,
        cached: &EntitlementCacheMetadata,
        trusted_now: u64,
    ) -> Option<EntitlementClaims> {
        self.verify_jws(&cached.entitlement_jws, trusted_now, false)
            .ok()
    }

    fn cache_from_claims(
        &self,
        token: &str,
        trusted_now: u64,
        claims: &EntitlementClaims,
    ) -> EntitlementCacheMetadata {
        EntitlementCacheMetadata {
            entitlement_jws: token.to_string(),
            cached_at_unix_ms: trusted_now,
            expires_at_unix_ms: claims.exp.saturating_mul(1000),
            last_trusted_time_unix_ms: trusted_now,
        }
    }

    pub fn evaluate(
        &self,
        entitlement_jws: Option<&str>,
        cached: Option<&EntitlementCacheMetadata>,
        now_unix_ms: u64,
    ) -> EntitlementEvaluation {
        let trusted_time_unix_ms = match cached {
            Some(existing) if now_unix_ms < existing.last_trusted_time_unix_ms => {
                return EntitlementEvaluation {
                    state: EntitlementState::Blocked,
                    code: "CLOCK_ROLLBACK_DETECTED".to_string(),
                    trusted_time_unix_ms: existing.last_trusted_time_unix_ms,
                    cache: cached.cloned(),
                    cache_updated: false,
                };
            }
            Some(existing) => existing.last_trusted_time_unix_ms.max(now_unix_ms),
            None => now_unix_ms,
        };

        if self.public_keys.is_empty() {
            return EntitlementEvaluation {
                state: EntitlementState::Blocked,
                code: "VERIFIER_KEYRING_UNAVAILABLE".to_string(),
                trusted_time_unix_ms,
                cache: cached.cloned(),
                cache_updated: false,
            };
        }

        if let Some(token) = entitlement_jws {
            match self.verify_jws(token, trusted_time_unix_ms, true) {
                Ok(claims) => {
                    if let Some(previous) =
                        cached.and_then(|c| self.claims_from_cache(c, trusted_time_unix_ms))
                    {
                        if previous.jti == claims.jti {
                            return EntitlementEvaluation {
                                state: EntitlementState::Restricted,
                                code: "JTI_REPLAYED".to_string(),
                                trusted_time_unix_ms,
                                cache: cached.cloned(),
                                cache_updated: false,
                            };
                        }
                    }

                    let next_cache = self.cache_from_claims(token, trusted_time_unix_ms, &claims);
                    let next_state = if claims.access_status == "blocked" {
                        EntitlementState::Blocked
                    } else {
                        EntitlementState::Active
                    };
                    let next_code = if claims.access_status == "blocked" {
                        "ACCESS_BLOCKED"
                    } else {
                        "TOKEN_VALID"
                    };

                    return EntitlementEvaluation {
                        state: next_state,
                        code: next_code.to_string(),
                        trusted_time_unix_ms,
                        cache_updated: cached != Some(&next_cache),
                        cache: Some(next_cache),
                    };
                }
                Err(VerifyError::TokenExpired) => {
                    if let Some(existing) = cached {
                        let grace_limit = existing
                            .expires_at_unix_ms
                            .saturating_add(self.policy.grace_period_ms);
                        if trusted_time_unix_ms <= grace_limit {
                            let next_cache = EntitlementCacheMetadata {
                                entitlement_jws: existing.entitlement_jws.clone(),
                                cached_at_unix_ms: existing.cached_at_unix_ms,
                                expires_at_unix_ms: existing.expires_at_unix_ms,
                                last_trusted_time_unix_ms: trusted_time_unix_ms,
                            };
                            return EntitlementEvaluation {
                                state: EntitlementState::Grace,
                                code: "TOKEN_EXPIRED_GRACE".to_string(),
                                trusted_time_unix_ms,
                                cache_updated: cached != Some(&next_cache),
                                cache: Some(next_cache),
                            };
                        }
                    }

                    return EntitlementEvaluation {
                        state: EntitlementState::Blocked,
                        code: "TOKEN_EXPIRED".to_string(),
                        trusted_time_unix_ms,
                        cache: cached.cloned(),
                        cache_updated: false,
                    };
                }
                Err(err) => {
                    return EntitlementEvaluation {
                        state: EntitlementState::Restricted,
                        code: err.code().to_string(),
                        trusted_time_unix_ms,
                        cache: cached.cloned(),
                        cache_updated: false,
                    };
                }
            }
        }

        if let Some(existing) = cached {
            if let Some(claims) = self.claims_from_cache(existing, trusted_time_unix_ms) {
                let next_cache = EntitlementCacheMetadata {
                    entitlement_jws: existing.entitlement_jws.clone(),
                    cached_at_unix_ms: existing.cached_at_unix_ms,
                    expires_at_unix_ms: existing.expires_at_unix_ms,
                    last_trusted_time_unix_ms: trusted_time_unix_ms,
                };

                if claims.access_status == "blocked" {
                    return EntitlementEvaluation {
                        state: EntitlementState::Blocked,
                        code: "ACCESS_BLOCKED".to_string(),
                        trusted_time_unix_ms,
                        cache_updated: cached != Some(&next_cache),
                        cache: Some(next_cache),
                    };
                }

                let exp_ms = claims.exp.saturating_mul(1000);
                if trusted_time_unix_ms <= exp_ms {
                    return EntitlementEvaluation {
                        state: EntitlementState::Active,
                        code: "CACHED_TOKEN_VALID".to_string(),
                        trusted_time_unix_ms,
                        cache_updated: cached != Some(&next_cache),
                        cache: Some(next_cache),
                    };
                }

                let grace_limit = exp_ms.saturating_add(self.policy.grace_period_ms);
                if trusted_time_unix_ms <= grace_limit {
                    return EntitlementEvaluation {
                        state: EntitlementState::Grace,
                        code: "USING_GRACE_CACHE".to_string(),
                        trusted_time_unix_ms,
                        cache_updated: cached != Some(&next_cache),
                        cache: Some(next_cache),
                    };
                }

                return EntitlementEvaluation {
                    state: EntitlementState::Blocked,
                    code: "GRACE_EXPIRED".to_string(),
                    trusted_time_unix_ms,
                    cache_updated: cached != Some(&next_cache),
                    cache: Some(next_cache),
                };
            }

            let next_cache = EntitlementCacheMetadata {
                entitlement_jws: existing.entitlement_jws.clone(),
                cached_at_unix_ms: existing.cached_at_unix_ms,
                expires_at_unix_ms: existing.expires_at_unix_ms,
                last_trusted_time_unix_ms: trusted_time_unix_ms,
            };
            return EntitlementEvaluation {
                state: EntitlementState::Restricted,
                code: "CACHED_TOKEN_INVALID".to_string(),
                trusted_time_unix_ms,
                cache_updated: cached != Some(&next_cache),
                cache: Some(next_cache),
            };
        }

        EntitlementEvaluation {
            state: EntitlementState::Blocked,
            code: "ENTITLEMENT_MISSING".to_string(),
            trusted_time_unix_ms,
            cache: None,
            cache_updated: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use ring::rand::SystemRandom;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    use super::*;

    fn policy() -> EntitlementVerifierPolicy {
        EntitlementVerifierPolicy {
            expected_issuer: "openpcb-license-service".to_string(),
            expected_audience: "openpcb-desktop".to_string(),
            grace_period_ms: 7 * 24 * 60 * 60 * 1000,
        }
    }

    fn make_keypair() -> Ed25519KeyPair {
        let rng = SystemRandom::new();
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&rng).expect("generate keypair");
        Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).expect("load keypair")
    }

    fn verifier_for_keypair(keypair: &Ed25519KeyPair) -> EntitlementVerifier {
        let mut public_keys = HashMap::new();
        public_keys.insert(
            "test-kid".to_string(),
            keypair.public_key().as_ref().to_vec(),
        );
        EntitlementVerifier {
            policy: policy(),
            public_keys,
        }
    }

    fn claims(now_sec: u64, jti: &str, access_status: &str, exp_sec: u64) -> EntitlementClaims {
        EntitlementClaims {
            iss: "openpcb-license-service".to_string(),
            aud: "openpcb-desktop".to_string(),
            sub: "account_1".to_string(),
            jti: jti.to_string(),
            iat: now_sec.saturating_sub(1),
            nbf: now_sec.saturating_sub(1),
            exp: exp_sec,
            schema_version: 1,
            account_id: "account_1".to_string(),
            device_id: "device_1".to_string(),
            license_id: "license_1".to_string(),
            access_status: access_status.to_string(),
            license_status: if access_status == "blocked" {
                "REVOKED".to_string()
            } else {
                "ACTIVE".to_string()
            },
            license_tier: "alpha-tester".to_string(),
        }
    }

    fn sign_token(keypair: &Ed25519KeyPair, kid: &str, claims: &EntitlementClaims) -> String {
        let header = serde_json::json!({"alg": "EdDSA", "typ": "JWT", "kid": kid});
        let encoded_header = encode_base64_url(
            serde_json::to_string(&header)
                .expect("serialize header")
                .as_bytes(),
        );
        let encoded_claims = encode_base64_url(
            serde_json::to_string(claims)
                .expect("serialize claims")
                .as_bytes(),
        );
        let signing_input = format!("{encoded_header}.{encoded_claims}");
        let signature = keypair.sign(signing_input.as_bytes());
        let encoded_signature = encode_base64_url(signature.as_ref());
        format!("{signing_input}.{encoded_signature}")
    }

    #[test]
    fn signature_failure_is_restricted() {
        let now = 1_700_000_000_000;
        let keypair = make_keypair();
        let verifier = verifier_for_keypair(&keypair);
        let token = sign_token(
            &keypair,
            "test-kid",
            &claims(
                now / 1000,
                "jti-signature-fail",
                "active",
                now / 1000 + 3600,
            ),
        );
        let tampered = format!("{token}x");

        let evaluation = verifier.evaluate(Some(&tampered), None, now);
        assert_eq!(evaluation.state, EntitlementState::Restricted);
        assert_eq!(evaluation.code, "INVALID_SIGNATURE");
    }

    #[test]
    fn expired_entitlement_enters_grace_then_blocks() {
        let now = 1_700_000_000_000;
        let keypair = make_keypair();
        let verifier = verifier_for_keypair(&keypair);
        let expired_claims = claims(now / 1000 - 600, "jti-expired", "active", now / 1000 - 5);
        let expired_token = sign_token(&keypair, "test-kid", &expired_claims);
        let cached = EntitlementCacheMetadata {
            entitlement_jws: expired_token,
            cached_at_unix_ms: now - 10_000,
            expires_at_unix_ms: expired_claims.exp * 1000,
            last_trusted_time_unix_ms: now,
        };

        let within_grace = verifier.evaluate(None, Some(&cached), now + 1_000);
        assert_eq!(within_grace.state, EntitlementState::Grace);
        assert_eq!(within_grace.code, "USING_GRACE_CACHE");

        let after_grace = verifier.evaluate(
            None,
            Some(&cached),
            cached.expires_at_unix_ms + policy().grace_period_ms + 60_000,
        );
        assert_eq!(after_grace.state, EntitlementState::Blocked);
        assert_eq!(after_grace.code, "GRACE_EXPIRED");
    }

    #[test]
    fn replayed_jti_is_restricted() {
        let now = 1_700_000_000_000;
        let keypair = make_keypair();
        let verifier = verifier_for_keypair(&keypair);
        let token = sign_token(
            &keypair,
            "test-kid",
            &claims(now / 1000, "jti-replayed", "active", now / 1000 + 3600),
        );
        let cached = EntitlementCacheMetadata {
            entitlement_jws: token.clone(),
            cached_at_unix_ms: now - 1000,
            expires_at_unix_ms: now + 100_000,
            last_trusted_time_unix_ms: now,
        };

        let evaluation = verifier.evaluate(Some(&token), Some(&cached), now + 1);
        assert_eq!(evaluation.state, EntitlementState::Restricted);
        assert_eq!(evaluation.code, "JTI_REPLAYED");
    }

    #[test]
    fn clock_rollback_detection_blocks() {
        let now = 1_700_000_000_000;
        let cached = EntitlementCacheMetadata {
            entitlement_jws: "cached.token".to_string(),
            cached_at_unix_ms: now,
            expires_at_unix_ms: now + 10_000,
            last_trusted_time_unix_ms: now + 5_000,
        };

        let keypair = make_keypair();
        let verifier = verifier_for_keypair(&keypair);
        let evaluation = verifier.evaluate(None, Some(&cached), now);
        assert_eq!(evaluation.state, EntitlementState::Blocked);
        assert_eq!(evaluation.code, "CLOCK_ROLLBACK_DETECTED");
    }

    #[test]
    fn active_and_blocked_transitions_are_deterministic() {
        let now = 1_700_000_000_000;
        let keypair = make_keypair();
        let verifier = verifier_for_keypair(&keypair);

        let active_token = sign_token(
            &keypair,
            "test-kid",
            &claims(now / 1000, "jti-active", "active", now / 1000 + 3600),
        );
        let active = verifier.evaluate(Some(&active_token), None, now);
        assert_eq!(active.state, EntitlementState::Active);
        assert_eq!(active.code, "TOKEN_VALID");

        let blocked_token = sign_token(
            &keypair,
            "test-kid",
            &claims(now / 1000, "jti-blocked", "blocked", now / 1000 + 3600),
        );
        let blocked = verifier.evaluate(Some(&blocked_token), None, now);
        assert_eq!(blocked.state, EntitlementState::Blocked);
        assert_eq!(blocked.code, "ACCESS_BLOCKED");
    }
}
