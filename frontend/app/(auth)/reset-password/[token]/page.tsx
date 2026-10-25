"use client";

import { useState, use } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import axios from "@/lib/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api-error";
import { AuthShell } from "@/features/auth/components/AuthShell";
import { AuthSubmit, PasswordField, authSecondaryClass } from "@/features/auth/components/fields";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default function ResetPasswordPage({ params }: PageProps) {
  const { token } = use(params);
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      return toast.error("Passwords do not match");
    }
    // Same floor as the API (min 8, one uppercase letter, one digit); it has the final word.
    if (password.length < 8) {
      return toast.error("Password must be at least 8 characters");
    }

    setLoading(true);
    setError(null);
    try {
      await axios.put(`/auth/reset-password/${token}`, { password });
      toast.success("Password reset successful! You can now log in.");
      router.push("/login");
    } catch (err) {
      const msg = getApiErrorMessage(err) || "Reset failed. The link may have expired.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <AuthShell icon={AlertCircle} tone="error" title="Reset link invalid" description={<span role="alert">{error}</span>}>
        <Button asChild className={authSecondaryClass}>
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" description="Pick something you haven't used before.">
      <form onSubmit={handleSubmit} className="space-y-5">
        <PasswordField
          id="password"
          name="password"
          label="New password"
          autoComplete="new-password"
          placeholder="Create a password"
          hint="At least 8 characters, with one uppercase letter and one number."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          required
        />
        <PasswordField
          id="confirmPassword"
          name="confirmPassword"
          label="Confirm new password"
          autoComplete="new-password"
          placeholder="Repeat the password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={loading}
          required
        />
        <AuthSubmit loading={loading} disabled={loading}>
          Reset password
        </AuthSubmit>
      </form>
    </AuthShell>
  );
}
