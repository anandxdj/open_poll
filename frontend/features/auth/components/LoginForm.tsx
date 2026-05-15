"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { JSX, SVGProps, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ProductLogo } from "@/components/ui/ProductLogo";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import axios from "@/lib/api-client";
import { toast } from "sonner";
import { getGoogleAuthUrl } from "@/lib/env";

const GoogleIcon = (props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>) => (
  <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
    <path d="M3.06364 7.50914C4.70909 4.24092 8.09084 2 12 2C14.6954 2 16.959 2.99095 18.6909 4.60455L15.8227 7.47274C14.7864 6.48185 13.4681 5.97727 12 5.97727C9.39542 5.97727 7.19084 7.73637 6.40455 10.1C6.2045 10.7 6.09086 11.3409 6.09086 12C6.09086 12.6591 6.2045 13.3 6.40455 13.9C7.19084 16.2636 9.39542 18.0227 12 18.0227C13.3454 18.0227 14.4909 17.6682 15.3864 17.0682C16.4454 16.3591 17.15 15.3 17.3818 14.05H12V10.1818H21.4181C21.5364 10.8363 21.6 11.5182 21.6 12.2273C21.6 15.2727 20.5091 17.8363 18.6181 19.5773C16.9636 21.1046 14.7 22 12 22C8.09084 22 4.70909 19.7591 3.06364 16.4909C2.38638 15.1409 2 13.6136 2 12C2 10.3864 2.38638 8.85911 3.06364 7.50914Z" />
  </svg>
);

const SSOIcon = (props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>) => (
  <svg fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export function LoginForm() {
  const router = useRouter();
  const { setToken, setUser } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return toast.error("Please fill in all fields");

    setLoading(true);
    try {
      const res = await axios.post("/auth/login", { email, password });
      const { user, accessToken } = res.data.data;
      
      setToken(accessToken);
      setUser(user);
      
      toast.success("Welcome back!");
      router.push("/polls");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-dvh bg-radial-glow px-6 overflow-hidden relative">
      {/* Ambient backgrounds */}
      <div className="absolute top-1/4 -left-20 size-96 bg-primary/10 blur-[120px] rounded-full animate-pulse" />
      <div className="absolute bottom-1/4 -right-20 size-96 bg-primary/5 blur-[100px] rounded-full animate-pulse [animation-delay:2s]" />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.32, 0.72, 0, 1] }}
        className="w-full max-w-sm relative z-10"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-10 text-center">
          <Link href="/" className="group flex items-center gap-3 mb-6">
            <div className="relative">
              <div className="absolute -inset-1.5 rounded-xl bg-primary/20 blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative size-10 flex items-center justify-center">
                <ProductLogo size={40} />
              </div>
            </div>
            <span className="text-xl font-bold tracking-tight text-foreground/90">
              Open Poll
            </span>
          </Link>
          <h2 className="text-balance text-center text-xl font-semibold text-foreground">
            Log in to your account
          </h2>
          <p className="text-sm text-muted-foreground mt-2">Enter your credentials to continue</p>
        </div>

        {/* Double Bezel Card */}
        <div className="relative group">
          <div className="absolute -inset-px rounded-3xl bg-gradient-to-b from-border/50 to-transparent opacity-50 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="absolute inset-[1px] rounded-[23px] bg-background/50 backdrop-blur-2xl" />
          
          <div className="relative p-8 space-y-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="font-medium text-foreground">
                  Email
                </Label>
                <Input
                  type="email"
                  id="email"
                  name="email"
                  autoComplete="email"
                  placeholder="john@company.com"
                  className="bg-secondary/10 border-border/50 h-11 px-4 rounded-xl"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="font-medium text-foreground">
                    Password
                  </Label>
                  <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                    Forgot?
                  </Link>
                </div>
                <Input
                  type="password"
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="bg-secondary/10 border-border/50 h-11 px-4 rounded-xl"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
              </div>
              <Button 
                type="submit" 
                className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg shadow-primary/20 hover:opacity-90 active:scale-[0.98] transition-all"
                disabled={loading}
              >
                {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Sign in
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full bg-border/50" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background/80 backdrop-blur-md px-3 text-muted-foreground font-medium tracking-wider">
                  or continue with
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Button
                variant="outline"
                className="h-11 rounded-xl border-border/50 bg-secondary/5 hover:bg-secondary/10 hover:text-foreground text-muted-foreground font-medium transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                disabled={true}
                title="Coming soon"
              >
                <SSOIcon className="size-4" aria-hidden={true} />
                <span className="text-xs">SSO</span>
              </Button>

              <Button
                asChild
                variant="outline"
                className="h-11 rounded-xl border-border/50 bg-secondary/5 hover:bg-secondary/10 hover:text-foreground text-muted-foreground font-medium transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                <a href={getGoogleAuthUrl()}>
                  <GoogleIcon className="size-4" aria-hidden={true} />
                  <span className="text-xs">Google</span>
                </a>
              </Button>
            </div>

            <p className="text-center text-sm text-muted-foreground pt-2">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="text-primary font-semibold hover:underline underline-offset-4">
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
