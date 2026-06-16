import "../global.css";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { onAuthStateChanged } from "firebase/auth";
import { StatusBar } from "expo-status-bar";
import Toast from "react-native-toast-message";
import { getItem as getStoredItem, deleteItem as deleteStoredItem } from "../lib/storage";
import {
  useFonts,
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
} from "@expo-google-fonts/montserrat";
import Ionicons from "@expo/vector-icons/Ionicons";
import AntDesign from "@expo/vector-icons/AntDesign";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { firebaseAuth } from "../lib/firebase";
import { queryClient } from "../lib/queryClient";
import { toastConfig } from "../lib/toastConfig";
import { useAuthStore } from "../stores/auth.store";
// Phase 4 addition: the enrollment store is hydrated here, right after
// `getMe()` succeeds — the spec calls this out explicitly even though this
// file isn't in Phase 4's file tree, since the auth guard is the only place
// that runs once per login for every screen in the app.
import { useAppStore } from "../stores/app.store";
import { getEnrollments } from "../services/enrollment.service";
import { getMe } from "../services/auth.service";
import { TOKEN_STORAGE_KEY } from "../services/api";
import LoadingSpinner from "../components/ui/LoadingSpinner";

function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const segments = useSegments();

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const setToken = useAuthStore((s) => s.setToken);
  const setLoading = useAuthStore((s) => s.setLoading);
  // Phase 4 addition — see import comment above for why this lives here.
  const setEnrollments = useAppStore((s) => s.setEnrollments);

  // Safety timeout — if Firebase never fires onAuthStateChanged within 8 s
  // (e.g. no internet on first cold start), stop showing the spinner so the
  // user at least reaches the login screen.
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 8000);
    return () => clearTimeout(t);
  }, [setLoading]);

  // 1. Subscribe to Firebase auth state and hydrate the store accordingly.
  //
  // Demo-login awareness: demo accounts bypass Firebase entirely, so
  // `firebaseUser` is always null for them. Before wiping the session we check
  // SecureStore for a stored token and call `getMe()` to validate it — this
  // handles both demo JWTs (locally-signed) and any unexpired Firebase token
  // that Firebase hasn't re-surfaced yet (e.g. cold app start).
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          // Normal Firebase sign-in path — get a fresh ID token and sync.
          const freshToken = await firebaseUser.getIdToken(true);
          await setToken(freshToken);
          const user = await getMe();
          setUser(user);

          try {
            const enrollments = await getEnrollments();
            setEnrollments(enrollments);
          } catch (enrollmentError) {
            console.error("[AuthGuard] failed to load enrollments:", enrollmentError);
          }
        } else {
          // Firebase reports no user.  Before clearing the session, check
          // whether there is already a valid token in SecureStore (placed
          // there by demo login or a prior Firebase session). If `getMe()`
          // succeeds the session is still alive; only clear on failure.
          const storedToken = await getStoredItem(TOKEN_STORAGE_KEY);
          if (storedToken) {
            try {
              // `getMe()` reads the token from api.ts's interceptor (which
              // pulls it from SecureStore), so no manual header needed here.
              const user = await getMe();
              setUser(user);

              try {
                const enrollments = await getEnrollments();
                setEnrollments(enrollments);
              } catch (enrollmentError) {
                console.error("[AuthGuard] failed to load enrollments:", enrollmentError);
              }
            } catch {
              // Token is invalid or expired — clear everything and force login,
              // but only if a concurrent demo-login hasn't already established
              // a fresh authenticated session while getMe() was in flight.
              const { isAuthenticated: nowAuthed } = useAuthStore.getState();
              if (!nowAuthed) {
                await deleteStoredItem(TOKEN_STORAGE_KEY);
                setUser(null);
                setEnrollments([]);
              }
            }
          } else {
            // Truly logged out — no Firebase user, no stored token.
            setUser(null);
            setEnrollments([]);
          }
        }
      } catch (error) {
        console.error("[AuthGuard] failed to sync auth state:", error);
        // Only clear session if demo-login (or another code path) hasn't
        // already authenticated the user while this async callback was in
        // flight.  Checking store state directly avoids a race where a
        // stale Firebase session failure wipes out a concurrent demo login.
        const { isAuthenticated: alreadyAuthed } = useAuthStore.getState();
        if (!alreadyAuthed) {
          setUser(null);
        }
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [setUser, setToken, setLoading, setEnrollments]);

  // 2. Redirect based on authentication state vs. the active route group.
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    const inOnboarding = segments[0] === "onboarding";
    const needsOnboarding =
      isAuthenticated && user?.role === "candidate" && user.profileComplete === false;

    if (!isAuthenticated && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (needsOnboarding && !inOnboarding) {
      router.replace("/onboarding");
    } else if (isAuthenticated && inAuthGroup) {
      router.replace(needsOnboarding ? "/onboarding" : "/(app)");
    }
  }, [isAuthenticated, isLoading, segments, router, user]);

  if (isLoading) {
    return <LoadingSpinner fullScreen size="large" />;
  }

  return <>{children}</>;
}

export default function RootLayout() {
  // Load the Stitch UI's Montserrat family before rendering any screen.
  const [fontsLoaded] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    // Load all vector icon fonts used in the app — Expo Go does not guarantee
    // these are pre-bundled in SDK 54, so we load them explicitly via tunnel.
    ...Ionicons.font,
    ...AntDesign.font,
    ...MaterialIcons.font,
  });

  if (!fontsLoaded) {
    return <LoadingSpinner fullScreen size="large" />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <AuthGuard>
        <Slot />
      </AuthGuard>
      <Toast config={toastConfig} />
    </QueryClientProvider>
  );
}
