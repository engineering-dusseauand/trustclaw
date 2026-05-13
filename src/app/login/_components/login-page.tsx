"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { authClient } from "~/clients/auth/react";
import { showErrorToast } from "~/components/core/toast-notifications";

export function LoginPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [isRegister, setIsRegister] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    try {
      if (isRegister) {
        const result = await authClient.signUp.email({
          email,
          password,
          username,
          name,
        });
        if (result.error) {
          showErrorToast(result.error.message ?? "Failed to create account");
          return;
        }
      } else {
        const result = await authClient.signIn.username({
          username,
          password,
        });
        if (result.error) {
          showErrorToast(result.error.message ?? "Failed to sign in");
          return;
        }
      }
      router.push("/dashboard");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-xs">
        <h1 className="mb-6 text-center text-xl font-medium text-foreground">
          trustclaw
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {isRegister && (
            <>
              <Input
                type="text"
                placeholder="Name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                type="email"
                placeholder="Email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </>
          )}
          <Input
            type="text"
            placeholder="Username"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" disabled={pending} className="mt-1">
            {pending
              ? isRegister
                ? "Creating..."
                : "Signing in..."
              : isRegister
                ? "Create account"
                : "Sign in"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setIsRegister(!isRegister)}
          className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {isRegister ? "Already have an account? Sign in" : "Need an account? Register"}
        </button>
      </div>
    </div>
  );
}
