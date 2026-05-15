"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, Loader2, ArrowLeft, MailCheck } from "lucide-react";
import Link from "next/link";
import axios from "@/lib/api-client";
import { toast } from "sonner";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return toast.error("Please enter your email address");

    setLoading(true);
    try {
      await axios.post("/auth/forgot-password", { email });
      setSubmitted(true);
      toast.success("Password reset link sent to your email.");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Something went wrong. Please try again.");
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
          <h2 className="text-2xl font-bold text-foreground">Reset Password</h2>
          <p className="text-sm text-muted-foreground mt-2">
            {submitted 
              ? "Check your inbox for the reset link" 
              : "We'll send a link to your email to reset your password"}
          </p>
        </div>

        {/* Double Bezel Card */}
        <div className="relative group">
          <div className="absolute -inset-px rounded-3xl bg-gradient-to-b from-border/50 to-transparent opacity-50 transition-opacity duration-500" />
          <div className="absolute inset-[1px] rounded-[23px] bg-background/50 backdrop-blur-2xl" />
          
          <div className="relative p-8 space-y-6">
            {!submitted ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="font-medium text-foreground">
                    Email Address
                  </Label>
                  <Input
                    type="email"
                    id="email"
                    placeholder="john@company.com"
                    className="bg-secondary/10 border-border/50 h-11 px-4 rounded-xl"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
                  Send Reset Link
                </Button>
                <Button asChild variant="ghost" className="w-full h-11 rounded-xl text-muted-foreground">
                  <Link href="/login" className="flex items-center justify-center gap-2">
                    <ArrowLeft className="size-4" />
                    Back to Login
                  </Link>
                </Button>
              </form>
            ) : (
              <div className="text-center space-y-6 py-4">
                <div className="flex justify-center">
                  <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <MailCheck className="size-8 text-primary" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-foreground">Email Sent!</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    We have sent a password reset link to <strong>{email}</strong>. 
                    The link will expire in 15 minutes.
                  </p>
                </div>
                <Button asChild className="w-full h-11 rounded-xl bg-primary shadow-lg shadow-primary/20">
                  <Link href="/login">Return to Login</Link>
                </Button>
                <p className="text-xs text-muted-foreground">
                  Didn't receive the email? Check your spam folder or{" "}
                  <button 
                    onClick={() => setSubmitted(false)}
                    className="text-primary hover:underline font-medium"
                  >
                    try again
                  </button>
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
