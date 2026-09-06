"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useSecurityRuntime } from "@/components/providers/SecurityRuntimeProvider";
import { useAuth } from "@/lib/hooks/use-auth";
import {
  createGoogleOneTapNonce,
  getGoogleOneTapClientId,
} from "@/lib/auth/google-one-tap";
import { normalizeAuthNextPath } from "@/lib/auth/redirects";

type GoogleCredentialResponse = {
  credential?: string;
  select_by?: string;
};

type GoogleOneTapConfiguration = {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  nonce: string;
  context: "signin" | "signup" | "use";
  auto_select: boolean;
  cancel_on_tap_outside: boolean;
  itp_support: boolean;
  use_fedcm_for_prompt: boolean;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (configuration: GoogleOneTapConfiguration) => void;
          prompt: () => void;
          cancel: () => void;
        };
      };
    };
  }
}

const GOOGLE_ONE_TAP_CLIENT_ID = getGoogleOneTapClientId();

export function GoogleOneTap({
  nextPath,
  onError,
}: {
  nextPath?: string | null;
  onError?: (message: string) => void;
}) {
  const { nonce: cspNonce } = useSecurityRuntime();
  const { signInWithGoogleIdToken } = useAuth();
  const [scriptReady, setScriptReady] = useState(false);
  const handlingCredentialRef = useRef(false);
  const errorRef = useRef(onError);
  const normalizedNextPath = normalizeAuthNextPath(nextPath);

  useEffect(() => {
    errorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!GOOGLE_ONE_TAP_CLIENT_ID || !scriptReady || !window.google) return;

    let cancelled = false;

    void createGoogleOneTapNonce()
      .then(({ raw, hashed }) => {
        if (cancelled || !window.google) return;

        window.google.accounts.id.initialize({
          client_id: GOOGLE_ONE_TAP_CLIENT_ID,
          callback: (response) => {
            const credential = response.credential?.trim() || "";
            if (!credential || cancelled || handlingCredentialRef.current) return;

            handlingCredentialRef.current = true;
            window.google?.accounts.id.cancel();

            void signInWithGoogleIdToken(credential, raw)
              .then((result) => {
                if (cancelled) return;
                if (result.error) {
                  handlingCredentialRef.current = false;
                  errorRef.current?.(result.error.message);
                  return;
                }

                // Use a hard navigation so the server immediately observes the
                // bridged Supabase cookies and applies onboarding/legal gates.
                window.location.assign(normalizedNextPath);
              })
              .catch(() => {
                if (cancelled) return;
                handlingCredentialRef.current = false;
                errorRef.current?.("Unable to complete Google sign-in. Please try again.");
              });
          },
          nonce: hashed,
          context: "use",
          auto_select: false,
          cancel_on_tap_outside: true,
          itp_support: true,
          use_fedcm_for_prompt: true,
        });
        window.google.accounts.id.prompt();
      })
      .catch(() => {
        // Keep the ordinary Google OAuth button as the silent fallback when
        // this browser cannot initialize One Tap or Web Crypto.
      });

    return () => {
      cancelled = true;
      window.google?.accounts.id.cancel();
    };
  }, [normalizedNextPath, scriptReady, signInWithGoogleIdToken]);

  if (!GOOGLE_ONE_TAP_CLIENT_ID) return null;

  return (
    <Script
      id="google-identity-services"
      src="https://accounts.google.com/gsi/client"
      nonce={cspNonce ?? undefined}
      strategy="afterInteractive"
      onLoad={() => setScriptReady(true)}
      onReady={() => setScriptReady(true)}
    />
  );
}
