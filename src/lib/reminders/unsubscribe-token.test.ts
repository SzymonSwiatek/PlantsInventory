import { describe, expect, it } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

const SECRET = "test-secret-32-bytes-long-enough";
const USER_ID = "00000000-0000-0000-0000-000000000001";

describe("signUnsubscribeToken / verifyUnsubscribeToken", () => {
  it("round-trip: a token signed for a user verifies true for that user", async () => {
    const token = await signUnsubscribeToken(USER_ID, SECRET);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    const valid = await verifyUnsubscribeToken(USER_ID, token, SECRET);
    expect(valid).toBe(true);
  });

  it("tampered user id: verifies false", async () => {
    const token = await signUnsubscribeToken(USER_ID, SECRET);
    const valid = await verifyUnsubscribeToken("different-user-id", token, SECRET);
    expect(valid).toBe(false);
  });

  it("tampered token: verifies false", async () => {
    const token = await signUnsubscribeToken(USER_ID, SECRET);
    const tampered = token.slice(0, -4) + "AAAA";
    const valid = await verifyUnsubscribeToken(USER_ID, tampered, SECRET);
    expect(valid).toBe(false);
  });

  it("wrong secret: verifies false", async () => {
    const token = await signUnsubscribeToken(USER_ID, SECRET);
    const valid = await verifyUnsubscribeToken(USER_ID, token, "different-secret");
    expect(valid).toBe(false);
  });

  it("garbage token string: verifies false without throwing", async () => {
    const valid = await verifyUnsubscribeToken(USER_ID, "not-base64url!!!", SECRET);
    expect(valid).toBe(false);
  });

  it("token is base64url (no +, /, or = padding)", async () => {
    const token = await signUnsubscribeToken(USER_ID, SECRET);
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
    expect(token).not.toContain("=");
  });

  it("same inputs always produce the same token (deterministic HMAC)", async () => {
    const t1 = await signUnsubscribeToken(USER_ID, SECRET);
    const t2 = await signUnsubscribeToken(USER_ID, SECRET);
    expect(t1).toBe(t2);
  });
});
