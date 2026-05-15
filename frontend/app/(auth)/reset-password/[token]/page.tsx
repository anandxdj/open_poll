"use client";

import { useState, use } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import Link from "next/link";
import axios from "@/lib/api-client";
import { toast } from "sonner";

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
    if (password.length < 6) {
      return toast.error("Password must be at least 6 characters");
    }

    setLoading(true);
    setError(null);
    try {
      await axios.put(`/auth/reset-password/${token}`, { password });
      toast.success("Password reset successful! You can now log in.");
      router.push("/login");
    } catch (err: any) {
      const msg = err.response?.data?.message || "Reset failed. The link may have expired.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-dvh bg-radial-glow px-6 overflow-hidden relative">
      {/* Ambient backgrounds */}
      <div className="absolute top-1/4 -right-20 size-96 bg-primary/10 blur-[120px] rounded-full animate-pulse" />
      <div className="absolute bottom-1/4 -left-20 size-96 bg-primary/5 blur-[100px] rounded-full animate-pulse [animation-delay:2s]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm relative z-10"
      >
        <div className="flex flex-col items-center mb-8 text-center">
          <Link href="/" className="group flex items-center gap-3 mb-6">
            <div className="relative size-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
              <Zap className="size-6 text-primary-foreground fill-primary-foreground" />
            </div>
          </Link>
          <h2 className="text-2xl font-bold text-foreground">Set New Password</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Please enter your new password below
          </p>
        </div>

        {/* Double Bezel Card */}
        <div className="relative group">
          <div className="absolute -inset-px rounded-3xl bg-gradient-to-b from-border/50 to-transparent opacity-50 transition-opacity duration-500" />
          <div className="absolute inset-[1px] rounded-[23px] bg-background/50 backdrop-blur-2xl" />
          
          <div className="relative p-8 space-y-6">
            {error ? (
              <div className="text-center space-y-6 py-4">
                <div className="flex justify-center">
                  <AlertCircle className="size-16 text-destructive" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-foreground">Reset Link Invalid</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {error}
                  </p>
                </div>
                <Button asChild className="w-full h-11 rounded-xl bg-primary shadow-lg shadow-primary/20">
                  <Link href="/forgot-password">Request New Link</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <Input
                    type="password"
                    id="password"
                    placeholder="••••••••"
                    className="bg-secondary/10 border-border/50 h-11 px-4 rounded-xl"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    type="password"
                    id="confirmPassword"
                    placeholder="••••••••"
                    className="bg-secondary/10 border-border/50 h-11 px-4 rounded-xl"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full h-11 rounded-xl bg-primary shadow-lg shadow-primary/20"
                  disabled={loading}
                >
                  {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                  Reset Password
                </Button>
              </form>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
