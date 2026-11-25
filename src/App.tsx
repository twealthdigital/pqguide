import React, { Suspense, lazy, useCallback, useMemo, useState } from 'react';
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

  // Tabs reset the trail. Alerts (opened from the bell) remembers where you were.
  const handleNavigate = useCallback((screen: AppScreen) => {
    setNav((prev) => {
      if (prev.screen === screen) return prev;
      const remember = screen === 'notifications' || screen === 'mock_exam';
      return { ...prev, screen, stack: remember ? [...prev.stack, entryOf(prev)] : [] };
    });
    scrollTop();
  }, []);

  // Back goes to exactly where the person came from (home if there is no trail).
  const handleBack = useCallback(() => {
    setNav((prev) => {
      const last = prev.stack[prev.stack.length - 1];
      if (!last) return { ...INITIAL_NAV, docId: prev.docId, materialId: prev.materialId };
      return { ...last, stack: prev.stack.slice(0, -1) };
    });
    scrollTop();
  }, []);

  const handleOpenDocument = useCallback((doc: PastQuestionDoc) => {
    archiveRepository.incrementView(doc.id);
    archiveRepository.recordRecent(doc.id);
    setNav((prev) => ({
      screen: 'reader',
      docId: doc.id,
      materialId: prev.materialId,
      stack: [...prev.stack, entryOf(prev)],
    }));
    scrollTop();
  }, []);

  const handleOpenMaterial = useCallback((material: StudyMaterial) => {
    setNav((prev) => ({
      screen: 'material_reader',
      docId: prev.docId,
      materialId: material.id,
      stack: [...prev.stack, entryOf(prev)],
    }));
    scrollTop();
  }, []);

  const handleQuickFind = useCallback(() => {
    setNav((prev) => ({ ...prev, screen: 'home', stack: [] }));
    setFocusSearchSignal((n) => n + 1);
  }, []);

  const handleSignOut = useCallback(() => {
    authService.clearActiveSession();
    setAuthenticatedStudent(null);
    setNav(INITIAL_NAV);
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

        {activeScreen === 'mock_exam' && <MockExamScreen onBack={handleBack} />}

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
