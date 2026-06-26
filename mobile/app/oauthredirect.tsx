import { useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";

import LoadingSpinner from "../components/ui/LoadingSpinner";
import { useAuthStore } from "../stores/auth.store";
import { isCandidateUser } from "../lib/mobileAuthAccess";

WebBrowser.maybeCompleteAuthSession();

export default function OAuthRedirectScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isOAuthProcessing = useAuthStore((s) => s.isOAuthProcessing);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!__DEV__) return;
    const keys = Object.keys(params);
    console.log("[OAuthRedirect] callback route reached", {
      paramKeys: keys,
      hasIdToken: keys.includes("id_token"),
      hasAccessToken: keys.includes("access_token"),
      hasCode: keys.includes("code"),
      hasError: keys.includes("error"),
    });
  }, [params]);

  useEffect(() => {
    if (isAuthenticated) {
      if (isCandidateUser(user)) {
        router.replace(user.profileComplete === false ? "/onboarding" : "/(app)");
      } else {
        router.replace("/(auth)/login");
      }
      return;
    }

    if (isOAuthProcessing) return;

    const fallback = setTimeout(() => {
      const state = useAuthStore.getState();
      if (!state.isAuthenticated && !state.isOAuthProcessing) {
        router.replace("/(auth)/login");
      }
    }, 8000);

    return () => clearTimeout(fallback);
  }, [isAuthenticated, isOAuthProcessing, router, user]);

  return <LoadingSpinner fullScreen size="large" />;
}
