import React, { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import type { AppScreen, PastQuestionDoc, StudentAccount } from './core/types';
import { useArchiveStore } from './hooks/useArchiveStore';
import { archiveRepository } from './services/archiveRepository';
import { authService } from './services/authService';
import { NavigationShell } from './components/ui/NavigationShell';
import { HomeScreenSkeleton } from './components/ui/Skeleton';
import { LoadingScreen } from './screens/LoadingScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { AuthScreen } from './screens/AuthScreen';
import { HomeScreen } from './screens/HomeScreen';

const PastQuestionReaderScreen = lazy(() =>
  import('./screens/PastQuestionReaderScreen').then((m) => ({
    default: m.PastQuestionReaderScreen,
  }))
);

const NotificationsScreen = lazy(() =>
  import('./screens/NotificationsScreen').then((m) => ({
    default: m.NotificationsScreen,
  }))
);

const SubscriptionScreen = lazy(() =>
  import('./screens/SubscriptionScreen').then((m) => ({
    default: m.SubscriptionScreen,
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
  const [focusSearchSignal, setFocusSearchSignal] = useState(0);

  const unreadCount = useMemo(
    () => store.notifications.filter((n) => !n.isRead).length,
    [store.notifications]
  );

  const selectedDoc = useMemo(
    () => store.documents.find((d) => d.id === selectedDocId) ?? null,
    [store.documents, selectedDocId]
  );

  const handleBootComplete = useCallback(() => {
    setIsBooting(false);
  }, []);

  const handleNavigate = useCallback((screen: AppScreen) => {
    setActiveScreen(screen);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleOpenDocument = useCallback((doc: PastQuestionDoc) => {
    archiveRepository.incrementView(doc.id);
    setSelectedDocId(doc.id);
    setActiveScreen('reader');
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      <OnboardingScreen
        onComplete={() => {
          authService.setOnboardingCompleted(true);
          setHasCompletedOnboarding(true);
        }}
      />
    );
  }

  if (!authenticatedStudent) {
    return (
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
    );
  }

  return (
    <NavigationShell
      activeScreen={activeScreen}
      onNavigate={handleNavigate}
      onQuickFind={handleQuickFind}
      unreadCount={unreadCount}
      activeTierId={store.activeTierId}
      activeRole={store.activeRole}
      onRoleChange={(role) => archiveRepository.setActiveRole(role)}
      student={authenticatedStudent}
      onSignOut={handleSignOut}
    >
      <Suspense fallback={<HomeScreenSkeleton />}>
        {activeScreen === 'home' && (
          <HomeScreen
            onNavigate={handleNavigate}
            onOpenDocument={handleOpenDocument}
            focusSearchSignal={focusSearchSignal}
          />
        )}

        {activeScreen === 'reader' && (
          <PastQuestionReaderScreen
            doc={selectedDoc}
            onBack={() => handleNavigate('home')}
            onNavigate={handleNavigate}
          />
        )}

        {activeScreen === 'notifications' && (
          <NotificationsScreen
            onBack={() => handleNavigate('home')}
            onOpenDocument={handleOpenDocument}
          />
        )}

        {activeScreen === 'subscription' && <SubscriptionScreen />}

        {activeScreen === 'school_admin' && <SchoolAdminScreen />}

        {activeScreen === 'super_admin' && <SuperAdminScreen />}
      </Suspense>
    </NavigationShell>
  );
}
