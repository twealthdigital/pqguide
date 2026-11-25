import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppScreen, PastQuestionDoc, StudentAccount, StudyMaterial } from './core/types';
import { useArchiveStore } from './hooks/useArchiveStore';
import { archiveRepository } from './services/archiveRepository';
import { authService } from './services/authService';
import { NavigationShell } from './components/ui/NavigationShell';
import { HomeScreenSkeleton } from './components/ui/Skeleton';
import { LoadingScreen } from './screens/LoadingScreen';
import { HomeScreen } from './screens/HomeScreen';
import { STUDY_MATERIALS } from './data/materials';

// Onboarding and auth are only needed by signed-out users, so they stay out of
// the main bundle that returning (signed-in) users download.
const loadOnboarding = () => import('./screens/OnboardingScreen');
const loadAuth = () => import('./screens/AuthScreen');

const OnboardingScreen = lazy(() =>
  loadOnboarding().then((m) => ({ default: m.OnboardingScreen }))
);

const AuthScreen = lazy(() =>
  loadAuth().then((m) => ({ default: m.AuthScreen }))
);

// Signed-out visitors see a splash first: fetch their next screens during it
// so there is no extra wait afterwards.
if (typeof window !== 'undefined' && authService.getActiveSession() === null) {
  void loadOnboarding();
  void loadAuth();
}

const PastQuestionReaderScreen = lazy(() =>
  import('./screens/PastQuestionReaderScreen').then((m) => ({
    default: m.PastQuestionReaderScreen,
  }))
);

const PastQuestionsScreen = lazy(() =>
  import('./screens/PastQuestionsScreen').then((m) => ({ default: m.PastQuestionsScreen }))
);

const InfoScreen = lazy(() =>
  import('./screens/InfoScreen').then((m) => ({ default: m.InfoScreen }))
);

const MaterialsScreen = lazy(() =>
  import('./screens/MaterialsScreen').then((m) => ({ default: m.MaterialsScreen }))
);

const MaterialReaderScreen = lazy(() =>
  import('./screens/MaterialReaderScreen').then((m) => ({ default: m.MaterialReaderScreen }))
);

const NotificationsScreen = lazy(() =>
  import('./screens/NotificationsScreen').then((m) => ({
    default: m.NotificationsScreen,
  }))
);


const MockExamScreen = lazy(() =>
  import('./screens/MockExamScreen').then((m) => ({ default: m.MockExamScreen }))
);

const PerformanceScreen = lazy(() =>
  import('./screens/PerformanceScreen').then((m) => ({ default: m.PerformanceScreen }))
);

const SchoolAdminScreen = lazy(() =>
  import('./screens/SchoolAdminScreen').then((m) => ({
    default: m.SchoolAdminScreen,
  }))
);

const SuperAdminScreen = lazy(() =>
  import('./screens/SuperAdminScreen').then((m) => ({
    default: m.SuperAdminScreen,
  }))
);

/** One step in the in-app "Back" trail. */
interface NavEntry {
  screen: AppScreen;
  docId: string | null;
  materialId: string | null;
}

interface NavState extends NavEntry {
  /** Screens the person came from, oldest first. Back pops the last one. */
  stack: NavEntry[];
}

const INITIAL_NAV: NavState = { screen: 'home', docId: null, materialId: null, stack: [] };

const entryOf = (n: NavState): NavEntry => ({
  screen: n.screen,
  docId: n.docId,
  materialId: n.materialId,
});

import { hasBackHandler, runTopBackHandler } from './core/navGuard';

function AppContent() {
  const store = useArchiveStore();
  const [authenticatedStudent, setAuthenticatedStudent] = useState<StudentAccount | null>(() =>
    authService.getActiveSession()
  );
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(
    () => authService.hasCompletedOnboarding() || authService.getActiveSession() !== null
  );
  const [nav, setNav] = useState<NavState>(INITIAL_NAV);
  const activeScreen = nav.screen;
  const selectedDocId = nav.docId;
  const selectedMaterialId = nav.materialId;
  // The screen "Back" would return to; also decides which tab stays highlighted
  // while a paper or guide is open.
  const parentScreen: AppScreen = nav.stack[nav.stack.length - 1]?.screen ?? 'home';
  const [focusSearchSignal, setFocusSearchSignal] = useState(0);

  // The latest nav, readable from handlers and from the phone's Back button.
  const navRef = useRef<NavState>(nav);
  navRef.current = nav;
  // Where we are in the browser history, so in-app "Back" and the phone's Back agree.
  const historyIdxRef = useRef(0);
  const skipGuardRef = useRef(false);

  const unreadCount = useMemo(
    () => store.notifications.filter((n) => !n.isRead).length,
    [store.notifications]
  );

  const selectedDoc = useMemo(
    () => store.documents.find((d) => d.id === selectedDocId) ?? null,
    [store.documents, selectedDocId]
  );

  const selectedMaterial = useMemo(
    () => STUDY_MATERIALS.find((m) => m.id === selectedMaterialId) ?? null,
    [selectedMaterialId]
  );

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'instant' });

  // Every move to a new screen adds a browser-history entry, so the phone's
  // Back button / gesture walks back through the same screens.
  const go = useCallback((next: NavState) => {
    navRef.current = next;
    setNav(next);
    historyIdxRef.current += 1;
    window.history.pushState({ nav: next, idx: historyIdxRef.current }, '');
    scrollTop();
  }, []);

  useEffect(() => {
    const existing = window.history.state as { idx?: number } | null;
    historyIdxRef.current = typeof existing?.idx === 'number' ? existing.idx : 0;
    window.history.replaceState({ nav: INITIAL_NAV, idx: historyIdxRef.current }, '');

    const onPopState = (event: PopStateEvent) => {
      const state = event.state as { nav?: NavState; idx?: number } | null;
      const idx = typeof state?.idx === 'number' ? state.idx : 0;

      // An open sheet / drawer / running exam takes the Back press first:
      // stay on this screen and let it close (or ask to confirm).
      if (skipGuardRef.current) {
        skipGuardRef.current = false;
      } else if (hasBackHandler()) {
        historyIdxRef.current = idx + 1;
        window.history.pushState({ nav: navRef.current, idx: historyIdxRef.current }, '');
        runTopBackHandler();
        return;
      }

      historyIdxRef.current = idx;
      const next = state?.nav ?? INITIAL_NAV;
      navRef.current = next;
      setNav(next);
      scrollTop();
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Tabs reset the trail. Alerts (opened from the bell) remembers where you were.
  const handleNavigate = useCallback(
    (screen: AppScreen) => {
      const prev = navRef.current;
      if (prev.screen === screen) return;
      const remember = screen === 'notifications' || screen === 'mock_exam';
      go({ ...prev, screen, stack: remember ? [...prev.stack, entryOf(prev)] : [] });
    },
    [go]
  );

  // Back goes to exactly where the person came from (home if there is no trail).
  const handleBack = useCallback(() => {
    if (historyIdxRef.current > 0) {
      skipGuardRef.current = true;
      window.setTimeout(() => {
        skipGuardRef.current = false;
      }, 600);
      window.history.back();
      return;
    }
    const prev = navRef.current;
    const last = prev.stack[prev.stack.length - 1];
    const next: NavState = last
      ? { ...last, stack: prev.stack.slice(0, -1) }
      : { ...INITIAL_NAV, docId: prev.docId, materialId: prev.materialId };
    navRef.current = next;
    setNav(next);
    scrollTop();
  }, []);

  const handleOpenDocument = useCallback(
    (doc: PastQuestionDoc) => {
      archiveRepository.incrementView(doc.id);
      archiveRepository.recordRecent(doc.id);
      const prev = navRef.current;
      go({
        screen: 'reader',
        docId: doc.id,
        materialId: prev.materialId,
        stack: [...prev.stack, entryOf(prev)],
      });
    },
    [go]
  );

  const handleOpenMaterial = useCallback(
    (material: StudyMaterial) => {
      const prev = navRef.current;
      go({
        screen: 'material_reader',
        docId: prev.docId,
        materialId: material.id,
        stack: [...prev.stack, entryOf(prev)],
      });
    },
    [go]
  );

  const handleQuickFind = useCallback(() => {
    const prev = navRef.current;
    if (prev.screen !== 'home') go({ ...prev, screen: 'home', stack: [] });
    setFocusSearchSignal((n) => n + 1);
  }, [go]);

  const handleSignOut = useCallback(() => {
    authService.clearActiveSession();
    setAuthenticatedStudent(null);
    navRef.current = INITIAL_NAV;
    setNav(INITIAL_NAV);
    window.history.replaceState({ nav: INITIAL_NAV, idx: historyIdxRef.current }, '');
  }, []);

  if (!hasCompletedOnboarding) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#F6F7F9]" />}>
        <OnboardingScreen
          onComplete={() => {
            authService.setOnboardingCompleted(true);
            setHasCompletedOnboarding(true);
          }}
        />
      </Suspense>
    );
  }

  if (!authenticatedStudent) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#F6F7F9]" />}>
        <AuthScreen
          onAuthenticated={(account) => {
            authService.saveActiveSession(account);
            setAuthenticatedStudent(account);
          }}
          onBackToOnboarding={() => {
            authService.setOnboardingCompleted(false);
            setHasCompletedOnboarding(false);
          }}
        />
      </Suspense>
    );
  }

  return (
    <NavigationShell
      activeScreen={activeScreen}
      parentScreen={parentScreen}
      onNavigate={handleNavigate}
      onQuickFind={handleQuickFind}
      unreadCount={unreadCount}
      activeRole={store.activeRole}
      onRoleChange={(role) => archiveRepository.setActiveRole(role)}
      student={authenticatedStudent}
      onSignOut={handleSignOut}
    >
      <Suspense fallback={<HomeScreenSkeleton />}>
        {activeScreen === 'home' && (
          <HomeScreen
            onOpenDocument={handleOpenDocument}
            focusSearchSignal={focusSearchSignal}
          />
        )}

        {activeScreen === 'reader' && (
          <PastQuestionReaderScreen
            doc={selectedDoc}
            onBack={handleBack}
          />
        )}

        {activeScreen === 'past_questions' && (
          <PastQuestionsScreen onOpenDocument={handleOpenDocument} />
        )}

        {activeScreen === 'notifications' && (
          <NotificationsScreen
            onBack={handleBack}
            onOpenDocument={handleOpenDocument}
          />
        )}

        {activeScreen === 'materials' && (
          <MaterialsScreen onOpenMaterial={handleOpenMaterial} />
        )}

        {activeScreen === 'material_reader' && (
          <MaterialReaderScreen
            material={selectedMaterial}
            onBack={handleBack}
          />
        )}

        {activeScreen === 'mock_exam' && (
          <MockExamScreen
            onBack={handleBack}
            onSubmitted={() => handleNavigate('performance')}
          />
        )}

        {activeScreen === 'performance' && (
          <PerformanceScreen onStartExam={() => handleNavigate('mock_exam')} />
        )}

        {(activeScreen === 'about' ||
          activeScreen === 'services' ||
          activeScreen === 'help' ||
          activeScreen === 'support') && (
          <InfoScreen page={activeScreen} onNavigate={handleNavigate} />
        )}

        {activeScreen === 'school_admin' && <SchoolAdminScreen />}

        {activeScreen === 'super_admin' && <SuperAdminScreen />}
      </Suspense>
    </NavigationShell>
  );
}

type BootPhase = 'splash' | 'reveal' | 'done';

export default function App() {
  // Signed-out visitors get the splash. The app mounts underneath it as the
  // splash starts to fade, so the fade reveals the real first screen.
  const [phase, setPhase] = useState<BootPhase>(() =>
    authService.getActiveSession() === null ? 'splash' : 'done'
  );

  return (
    <>
      {phase !== 'splash' && <AppContent />}
      {phase !== 'done' && (
        <LoadingScreen
          onReveal={() => setPhase((p) => (p === 'splash' ? 'reveal' : p))}
          onComplete={() => setPhase('done')}
        />
      )}
    </>
  );
}
