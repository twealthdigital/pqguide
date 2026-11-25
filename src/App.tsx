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

export default function App() {
  const store = useArchiveStore();
  const [authenticatedStudent, setAuthenticatedStudent] = useState<StudentAccount | null>(() =>
    authService.getActiveSession()
  );
  const [isBooting, setIsBooting] = useState(() => authService.getActiveSession() === null);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(
    () => authService.hasCompletedOnboarding() || authService.getActiveSession() !== null
  );
  const [activeScreen, setActiveScreen] = useState<AppScreen>('home');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
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

  const handleBootComplete = useCallback(() => {
    setIsBooting(false);
  }, []);

  const handleNavigate = useCallback((screen: AppScreen) => {
    setActiveScreen(screen);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const handleOpenDocument = useCallback((doc: PastQuestionDoc) => {
    archiveRepository.incrementView(doc.id);
    setSelectedDocId(doc.id);
    setActiveScreen('reader');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const handleOpenMaterial = useCallback((material: StudyMaterial) => {
    setSelectedMaterialId(material.id);
    setActiveScreen('material_reader');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const handleQuickFind = useCallback(() => {
    setActiveScreen('home');
    setFocusSearchSignal((n) => n + 1);
  }, []);

  const handleSignOut = useCallback(() => {
    authService.clearActiveSession();
    setAuthenticatedStudent(null);
    setSelectedDocId(null);
    setActiveScreen('home');
  }, []);

  if (isBooting) {
    return <LoadingScreen onComplete={handleBootComplete} />;
  }

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
            onBack={() => handleNavigate('home')}
          />
        )}

        {activeScreen === 'notifications' && (
          <NotificationsScreen
            onBack={() => handleNavigate('home')}
            onOpenDocument={handleOpenDocument}
          />
        )}

        {activeScreen === 'materials' && (
          <MaterialsScreen onOpenMaterial={handleOpenMaterial} />
        )}

        {activeScreen === 'material_reader' && (
          <MaterialReaderScreen
            material={selectedMaterial}
            onBack={() => handleNavigate('materials')}
          />
        )}

        {activeScreen === 'school_admin' && <SchoolAdminScreen />}

        {activeScreen === 'super_admin' && <SuperAdminScreen />}
      </Suspense>
    </NavigationShell>
  );
}
