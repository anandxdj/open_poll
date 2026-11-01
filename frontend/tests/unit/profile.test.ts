import { describe, expect, it } from "bun:test";
import { NAME_MAX_LENGTH, nameProblem, newPasswordProblem, signInMethod } from "@/features/profile/account";

describe("profile name", () => {
  it("needs 1 to 80 characters after trimming", () => {
    expect(nameProblem("")).toBe("Enter your name.");
    expect(nameProblem("   ")).toBe("Enter your name.");
    expect(nameProblem("A")).toBeNull();
    expect(nameProblem(`  ${"x".repeat(NAME_MAX_LENGTH)}  `)).toBeNull();
    expect(nameProblem("x".repeat(NAME_MAX_LENGTH + 1))).toBe("Use at most 80 characters.");
  });
});

describe("new password", () => {
  it("follows the reset-password floor: 8 characters, an uppercase letter and a digit", () => {
    expect(newPasswordProblem("Short1A")).toBe("Use at least 8 characters.");
    expect(newPasswordProblem("alllowercase1")).toBe("Include at least one uppercase letter and one number.");
    expect(newPasswordProblem("NoDigitsHere")).toBe("Include at least one uppercase letter and one number.");
    expect(newPasswordProblem("Good-Pass-9")).toBeNull();
  });
});

describe("sign-in method of a passwordless account", () => {
  it("names Google, single sign-on, or both when unsure", () => {
    expect(signInMethod([{ provider: "google" }])).toBe("Google");
    expect(signInMethod([{ provider: "saml" }])).toBe("single sign-on");
    expect(signInMethod([{ provider: "oidc" }, { provider: "oidc_ws" }])).toBe("single sign-on");
    expect(signInMethod([{ provider: "google" }, { provider: "saml" }])).toBe("Google or single sign-on");
    expect(signInMethod([])).toBe("Google or single sign-on");
    expect(signInMethod(undefined)).toBe("Google or single sign-on");
  });
});
