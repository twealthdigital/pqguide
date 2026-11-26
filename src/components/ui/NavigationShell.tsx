import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ClipboardCheck,
  CreditCard,
  Crown,
  Eye as PreviewEye,
  EyeOff as PreviewOff,
  FileText,
  Folder,
  Globe,
  Headphones,
  HelpCircle,
  Home,
  Inbox,
  Info,
  Layers,
  LayoutDashboard,
  Lock,
  LogOut,
  Megaphone,
  MoreVertical,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
  User,
  Users,
  X,
} from 'lucide-react';
import type {
  AppScreen,
  AuthenticatedUser,
  HeaderMarqueeConfig,
  SchoolAdminSectionId,
  SettingsUiTarget,
  SuperAdminSectionId,
  WorkspaceViewMode,
} from '../../core/types';
import {
  canAccessScreen,
  getDefaultScreenForRole,
  isRestrictedAccount,
  ROLE_LABELS,
} from '../../core/permissions';
import { FREE_TIER_ENABLED, useSubscription, type PaywallContext } from '../../core/subscription';
import { BrandLockup } from './BrandLockup';
import { useBackHandler } from '../../core/navGuard';
import { BrandLogo } from './BrandLogo';
import { CustomSelect } from './CustomSelect';
import { TactileButton } from './TactileButton';
import { TooltipBubble } from './TooltipBubble';

interface NavigationShellProps {
  activeScreen: AppScreen;
  /** Screen Back returns to; keeps the right tab lit while a paper/guide is open. */
  parentScreen?: AppScreen;
  workspaceMode?: WorkspaceViewMode;
  onWorkspaceModeChange?: (mode: WorkspaceViewMode) => void;
  activeAdminSection?: SuperAdminSectionId;
  onSelectAdminSection?: (section: SuperAdminSectionId) => void;
  activeSchoolAdminSection?: SchoolAdminSectionId;
  onSelectSchoolAdminSection?: (section: SchoolAdminSectionId) => void;
  settingsTarget?: SettingsUiTarget;
  onSelectSettingsTarget?: (target: SettingsUiTarget) => void;
  openSupportCount?: number;
  marquee?: HeaderMarqueeConfig;
  onNavigate: (screen: AppScreen) => void;
  onOpenPaywall: (context?: PaywallContext) => void;
  onQuickFind: () => void;
  unreadCount: number;
  student: AuthenticatedUser;
  onSignOut: () => void;
  children: React.ReactNode;
}

function getStudentInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ST';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const NavigationShell: React.FC<NavigationShellProps> = ({
  activeScreen,
  parentScreen = 'home',
  workspaceMode,
  onWorkspaceModeChange,
  activeAdminSection = 'overview',
  onSelectAdminSection,
  activeSchoolAdminSection = 'overview',
  onSelectSchoolAdminSection,
  settingsTarget = 'normal_website',
  onSelectSettingsTarget,
  openSupportCount = 0,
  marquee,
  onNavigate,
  onOpenPaywall,
  onQuickFind,
  unreadCount,
  student,
  onSignOut,
  children,
}) => {
  const { activeTier } = useSubscription();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false);
  const [mobileSettingsExpanded, setMobileSettingsExpanded] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('pqguide:sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [swipeOffsetX, setSwipeOffsetX] = useState(0);
  const [isSwipingDrawer, setIsSwipingDrawer] = useState(false);

  useBackHandler(drawerOpen, () => setDrawerOpen(false));
  useBackHandler(accountMenuOpen, () => setAccountMenuOpen(false));
  useBackHandler(workspaceDropdownOpen, () => setWorkspaceDropdownOpen(false));

  const desktopTriggerRef = useRef<HTMLButtonElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceDropdownRef = useRef<HTMLDivElement | null>(null);
  const userPanelRef = useRef<HTMLDivElement | null>(null);
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
  const drawerPanelRef = useRef<HTMLElement | null>(null);
  const signOutTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const gestureAxisRef = useRef<'pending' | 'horizontal' | 'vertical' | null>(null);

  const initials = getStudentInitials(student.fullName);

  useEffect(() => {
    const vv = window.visualViewport;
    let baseHeight = Math.max(window.innerHeight, vv?.height ?? 0);
    let blurTimer: number | undefined;

    const isTyping = () => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return false;
      if (el instanceof HTMLTextAreaElement || el.isContentEditable) return true;
      if (el instanceof HTMLInputElement) {
        return !['checkbox', 'radio', 'button', 'submit', 'range', 'file'].includes(el.type);
      }
      return false;
    };

    const update = () => {
      const height = vv?.height ?? window.innerHeight;
      if (!isTyping()) baseHeight = Math.max(window.innerHeight, height);
      setKeyboardOpen(isTyping() && baseHeight - height > 120);
    };
    const onFocusIn = () => {
      window.clearTimeout(blurTimer);
      update();
    };
    const onFocusOut = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(update, 60);
    };

    vv?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      window.clearTimeout(blurTimer);
      vv?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    return () => {
      if (signOutTimerRef.current !== null) {
        window.clearTimeout(signOutTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const inDesktop = desktopTriggerRef.current?.contains(target);
      const inMenu = accountMenuRef.current?.contains(target);
      if (!inDesktop && !inMenu) {
        setAccountMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAccountMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!workspaceDropdownOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (workspaceDropdownRef.current?.contains(target)) return;
      setWorkspaceDropdownOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setWorkspaceDropdownOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [workspaceDropdownOpen]);

  useEffect(() => {
    if (!drawerOpen) {
      setSwipeOffsetX(0);
      setIsSwipingDrawer(false);
      touchStartRef.current = null;
      gestureAxisRef.current = null;
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [drawerOpen]);

  const handleDrawerTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (!drawerOpen || e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: performance.now(),
    };
    gestureAxisRef.current = 'pending';
  };

  const handleDrawerTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    const start = touchStartRef.current;
    if (!start || e.touches.length !== 1) return;
    if (gestureAxisRef.current === 'vertical') return;

    const touch = e.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    if (gestureAxisRef.current === 'pending') {
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absX < 10 && absY < 10) return;

      if (absY >= absX * 0.85 || dx <= 0) {
        gestureAxisRef.current = 'vertical';
        return;
      }

      gestureAxisRef.current = 'horizontal';
      setIsSwipingDrawer(true);
    }

    if (gestureAxisRef.current === 'horizontal') {
      setSwipeOffsetX(Math.max(0, dx));
    }
  };

  const handleDrawerTouchEnd = () => {
    const start = touchStartRef.current;
    const axis = gestureAxisRef.current;

    touchStartRef.current = null;
    gestureAxisRef.current = null;

    if (axis !== 'horizontal' || !start) {
      setIsSwipingDrawer(false);
      setSwipeOffsetX(0);
      return;
    }

    const panelWidth = drawerPanelRef.current?.offsetWidth || 300;
    const elapsed = Math.max(1, performance.now() - start.time);
    const velocityX = swipeOffsetX / elapsed;

    const shouldClose =
      swipeOffsetX > panelWidth * 0.32 ||
      (velocityX > 0.35 && swipeOffsetX > 28);

    setIsSwipingDrawer(false);
    setSwipeOffsetX(0);

    if (shouldClose) {
      setDrawerOpen(false);
    }
  };

  const handleSignOutClick = () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    signOutTimerRef.current = window.setTimeout(() => {
      setIsSigningOut(false);
      setAccountMenuOpen(false);
      setDrawerOpen(false);
      onSignOut();
    }, 450);
  };

  const hasBanner =
    activeScreen === 'home' ||
    activeScreen === 'past_questions' ||
    activeScreen === 'materials';

  const tabScreen: AppScreen =
    activeScreen === 'reader'
      ? parentScreen
      : activeScreen === 'material_reader'
        ? 'materials'
        : activeScreen;

  const isSuperAdmin = student.role === 'super_admin';
  const isSchoolAdmin = student.role === 'school_admin';
  const effectiveWorkspace: WorkspaceViewMode = isSuperAdmin
    ? workspaceMode ?? 'super_admin'
    : isSchoolAdmin
      ? 'school_admin'
      : 'student';
  const isAdminWorkspace = effectiveWorkspace !== 'student';
  const isSuperAdminConsole = isSuperAdmin && effectiveWorkspace === 'super_admin';
  const isSchoolAdminConsole = effectiveWorkspace === 'school_admin';
  const showStudentBottomBar = !isAdminWorkspace;
  const showSubscriptionCta = !isSchoolAdmin && (!isSuperAdmin || effectiveWorkspace === 'student');

  const showMarquee = Boolean(
    marquee?.enabled &&
      marquee.message.trim() &&
      (marquee.audience === 'all' ||
        (isAdminWorkspace ? marquee.audience === 'admins' : marquee.audience === 'students'))
  );

  const marqueeToneClass =
    marquee?.tone === 'urgent'
      ? 'bg-[#B91C1C] text-white'
      : marquee?.tone === 'important'
        ? 'bg-[#92400E] text-white'
        : 'bg-[#1D1E23] text-white';

  const defaultScreen = getDefaultScreenForRole(student.role, effectiveWorkspace);
  const roleBadgeLabel =
    student.role === 'school_admin' && student.assignedSchoolCode
      ? `${ROLE_LABELS[student.role]} · ${student.assignedSchoolCode}`
      : ROLE_LABELS[student.role];

  const allNavItems: Array<{
    id: AppScreen;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = isSchoolAdmin
    ? []
    : isSuperAdmin
      ? effectiveWorkspace === 'student'
        ? [
            { id: 'home', label: 'Home', icon: <Home className="w-5 h-5" /> },
            { id: 'past_questions', label: 'Past Questions', icon: <FileText className="w-5 h-5" /> },
            { id: 'materials', label: 'Materials', icon: <Folder className="w-5 h-5" /> },
            { id: 'mock_exam', label: 'Practice Exam', icon: <ClipboardCheck className="w-5 h-5" /> },
            { id: 'performance', label: 'Performance', icon: <BarChart3 className="w-5 h-5" /> },
          ]
        : []
      : [
          { id: 'home', label: 'Home', icon: <Home className="w-5 h-5" /> },
          { id: 'past_questions', label: 'Past Questions', icon: <FileText className="w-5 h-5" /> },
          { id: 'materials', label: 'Materials', icon: <Folder className="w-5 h-5" /> },
          { id: 'mock_exam', label: 'Practice Exam', icon: <ClipboardCheck className="w-5 h-5" /> },
          { id: 'performance', label: 'Performance', icon: <BarChart3 className="w-5 h-5" /> },
        ];

  const navItems = allNavItems.filter((item) => canAccessScreen(student, item.id));

  // Dedicated School Admin pages inside the side panel
  const schoolAdminPages: Array<{
    id: SchoolAdminSectionId;
    label: string;
    icon: React.ReactNode;
  }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-[18px] h-[18px]" /> },
    { id: 'students', label: 'Students', icon: <Users className="w-[18px] h-[18px]" /> },
    { id: 'upload', label: 'Upload Documents', icon: <UploadCloud className="w-[18px] h-[18px]" /> },
    { id: 'catalog', label: 'Past Questions', icon: <FileText className="w-[18px] h-[18px]" /> },
    { id: 'notices', label: 'Student Notices', icon: <Bell className="w-[18px] h-[18px]" /> },
  ];

  // Dedicated Super Admin console sections inside the rounded sidebar container
  const superAdminPages: Array<{
    id: SuperAdminSectionId;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-[18px] h-[18px]" /> },
    { id: 'students', label: 'Students', icon: <Users className="w-[18px] h-[18px]" /> },
    { id: 'universities', label: 'Universities', icon: <Building2 className="w-[18px] h-[18px]" /> },
    { id: 'administrators', label: 'Administrators', icon: <ShieldCheck className="w-[18px] h-[18px]" /> },
    { id: 'activities', label: 'Activities', icon: <Activity className="w-[18px] h-[18px]" /> },
    { id: 'actions', label: 'Actions', icon: <ShieldAlert className="w-[18px] h-[18px]" /> },
    { id: 'announcements', label: 'Announcements', icon: <Megaphone className="w-[18px] h-[18px]" /> },
    {
      id: 'support_inbox',
      label: 'Support Inbox',
      icon: <Inbox className="w-[18px] h-[18px]" />,
      badge: openSupportCount,
    },
    { id: 'past_questions', label: 'Past Questions', icon: <FileText className="w-[18px] h-[18px]" /> },
    { id: 'study_materials', label: 'Study Materials', icon: <BookOpen className="w-[18px] h-[18px]" /> },
    { id: 'payments', label: 'Payments', icon: <CreditCard className="w-[18px] h-[18px]" /> },
  ];

  const infoLinks: Array<{ id: AppScreen; label: string; icon: React.ReactNode }> = [
    { id: 'about', label: 'About', icon: <Info className="w-5 h-5" /> },
    { id: 'services', label: 'Services', icon: <Layers className="w-5 h-5" /> },
    { id: 'help', label: 'Help', icon: <HelpCircle className="w-5 h-5" /> },
    { id: 'support', label: 'Customer Support', icon: <Headphones className="w-5 h-5" /> },
  ];

  const workspaceModes: Array<{
    id: WorkspaceViewMode;
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
  }> = [
    { id: 'super_admin', label: 'Super Admin', shortLabel: 'Super Admin', icon: <ShieldCheck className="w-4 h-4" /> },
    { id: 'school_admin', label: 'School Admin View', shortLabel: 'School Admin', icon: <UploadCloud className="w-4 h-4" /> },
    { id: 'student', label: 'Student Website', shortLabel: 'Student Site', icon: <Globe className="w-4 h-4" /> },
  ];

  const activeWorkspaceOption =
    workspaceModes.find((m) => m.id === effectiveWorkspace) ?? workspaceModes[0];

  const onBanner = false;
  const userPopoverVisible = sidebarCollapsed && userPopoverOpen;
  const settingsPopoverVisible = sidebarCollapsed && settingsPopoverOpen;

  useBackHandler(userPopoverVisible, () => setUserPopoverOpen(false));
  useBackHandler(settingsPopoverVisible, () => setSettingsPopoverOpen(false));

  useEffect(() => {
    if (!sidebarCollapsed) {
      setUserPopoverOpen(false);
      setSettingsPopoverOpen(false);
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (activeScreen === 'super_admin' && activeAdminSection === 'settings') {
      setSettingsMenuOpen(true);
      setMobileSettingsExpanded(true);
    }
  }, [activeScreen, activeAdminSection]);

  useEffect(() => {
    if (!userPopoverVisible) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && userPanelRef.current?.contains(target)) return;
      setUserPopoverOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setUserPopoverOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [userPopoverVisible]);

  useEffect(() => {
    if (!settingsPopoverVisible) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && settingsPanelRef.current?.contains(target)) return;
      setSettingsPopoverOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsPopoverOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [settingsPopoverVisible]);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('pqguide:sidebar-collapsed', next ? '1' : '0');
      } catch {
        /* storage unavailable: keep in memory only */
      }
      return next;
    });
  };
  const sbEase = 'duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none';

  const handlePickSuperAdminSection = (section: SuperAdminSectionId) => {
    if (onSelectAdminSection) {
      onSelectAdminSection(section);
    }
    if (activeScreen !== 'super_admin') {
      onNavigate('super_admin');
    }
  };

  const handlePickSchoolAdminSection = (section: SchoolAdminSectionId) => {
    if (onSelectSchoolAdminSection) {
      onSelectSchoolAdminSection(section);
    }
    if (activeScreen !== 'school_admin') {
      onNavigate('school_admin');
    }
  };

  const handleLogoHomeClick = () => {
    if (isSuperAdminConsole && onSelectAdminSection) {
      handlePickSuperAdminSection('overview');
      return;
    }
    if (isSchoolAdminConsole && onSelectSchoolAdminSection) {
      handlePickSchoolAdminSection('overview');
      return;
    }
    onNavigate(defaultScreen);
  };

  const handleOpenUiEditsPage = () => {
    handlePickSuperAdminSection('settings');
    setSettingsPopoverOpen(false);
  };

  const renderSubscriptionSubline = () => {
    if (activeTier === 'infinity') return 'Infinity Plan · All unlocked';
    if (activeTier === 'standard') return 'Standard · Upgrade to AI';
    if (activeTier === 'pro_ai') return 'AI Scholar Active';
    return FREE_TIER_ENABLED ? 'Free plan · Upgrade anytime' : 'Unlock full access';
  };

  return (
    <div className="min-h-[100dvh] bg-[#F6F7F9] text-[#1A1B20] flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar */}
      <aside
        data-collapsed={sidebarCollapsed}
        className={`hidden lg:flex lg:flex-col lg:shrink-0 bg-white border-r border-[#1A1B20]/[0.07] sticky top-0 z-40 h-screen justify-between transition-[width,padding] ${sbEase} ${
          sidebarCollapsed ? 'lg:w-[104px] px-3.5 py-5' : 'lg:w-64 p-5'
        }`}
      >
        {/* Edge toggle: collapse / expand the side panel */}
        <div className="absolute -right-3.5 top-[88px] z-50">
          <TooltipBubble
            content={sidebarCollapsed ? 'Expand side panel' : 'Collapse side panel'}
            side="right"
          >
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? 'Expand side panel' : 'Collapse side panel'}
              aria-expanded={!sidebarCollapsed}
              className="h-7 w-7 rounded-full bg-white border border-[#1A1B20]/[0.1] text-[#1D1E23] shadow-[0_4px_12px_-4px_rgba(18,19,24,0.3)] flex items-center justify-center cursor-pointer hover:bg-[#1D1E23] hover:text-white active:scale-95 transition-colors duration-150"
            >
              <ChevronLeft
                className={`w-4 h-4 transition-transform ${sbEase} ${sidebarCollapsed ? 'rotate-180' : ''}`}
              />
            </button>
          </TooltipBubble>
        </div>

        <div
          className={
            isSuperAdminConsole || isSchoolAdminConsole
              ? 'min-h-0 flex-1 flex flex-col gap-3.5 pb-3'
              : 'no-scrollbar min-h-0 flex-1 overflow-y-auto space-y-3.5 pb-3'
          }
        >
          <button
            type="button"
            onClick={handleLogoHomeClick}
            aria-label="pqguide home"
            className="shrink-0 block w-full text-left cursor-pointer group"
          >
            <span className="relative block h-11 w-full overflow-hidden">
              <BrandLockup
                className={`absolute left-0 top-1/2 h-9 w-auto -translate-y-1/2 origin-left text-[#1A1B20] transition-[opacity,transform] ${sbEase} ${
                  sidebarCollapsed ? 'opacity-0 scale-75 pointer-events-none' : 'opacity-100 scale-100'
                }`}
              />
              <span
                aria-hidden="true"
                className={`absolute top-1/2 h-11 w-11 -translate-y-1/2 rounded-[14px] bg-[#1D1E23] text-white flex items-center justify-center transition-[opacity,transform,left] ${sbEase} ${
                  sidebarCollapsed
                    ? 'left-1/2 -translate-x-1/2 opacity-100 scale-100'
                    : 'left-0 opacity-0 scale-75 pointer-events-none'
                }`}
              >
                <BrandLogo className="w-7" />
              </span>
            </span>
            <span
              className={`block overflow-hidden whitespace-nowrap text-xs text-[#686C78] transition-[max-height,opacity,margin] ${sbEase} ${
                sidebarCollapsed ? 'max-h-0 opacity-0 mt-0' : 'max-h-6 opacity-100 mt-2'
              }`}
            >
              {isSchoolAdmin
                ? `School Admin · ${student.assignedSchoolCode ?? 'AAUA'}`
                : isSuperAdmin
                  ? effectiveWorkspace === 'super_admin'
                    ? 'Super Admin Control'
                    : effectiveWorkspace === 'school_admin'
                      ? 'Preview: School Admin'
                      : 'Infinity · Student Site'
                  : 'University Exam Home'}
            </span>
          </button>

          {/* Active Workspace Dropdown (Desktop Sidebar) */}
          {isSuperAdmin && onWorkspaceModeChange && (
            <div ref={workspaceDropdownRef} className="relative shrink-0">
              {!sidebarCollapsed && (
                <p className="px-1 mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#686C78]">
                  Active Workspace
                </p>
              )}
              <TooltipBubble
                fullWidth
                content={
                  sidebarCollapsed
                    ? `Workspace: ${activeWorkspaceOption.label}`
                    : 'Switch active workspace view'
                }
                side="right"
              >
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={workspaceDropdownOpen}
                  onClick={() => setWorkspaceDropdownOpen((prev) => !prev)}
                  className={`w-full min-h-[44px] rounded-2xl bg-[#1D1E23] text-white text-xs font-semibold flex items-center cursor-pointer hover:bg-[#2B2D35] transition-colors ${
                    sidebarCollapsed ? 'justify-center px-0' : 'justify-between px-3 gap-2'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0">{activeWorkspaceOption.icon}</span>
                    {!sidebarCollapsed && (
                      <span className="truncate">{activeWorkspaceOption.label}</span>
                    )}
                  </span>
                  {!sidebarCollapsed && (
                    <ChevronDown
                      className={`w-4 h-4 shrink-0 text-[#C3C7D2] transition-transform duration-200 ${
                        workspaceDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </button>
              </TooltipBubble>

              {workspaceDropdownOpen && (
                <div
                  role="listbox"
                  aria-label="Select workspace"
                  className={`z-50 mt-1.5 rounded-2xl bg-white border border-[#1A1B20]/[0.1] shadow-[0_18px_38px_-12px_rgba(18,19,24,0.34)] p-1.5 space-y-1 page-enter ${
                    sidebarCollapsed
                      ? 'fixed left-[108px] top-[148px] w-56'
                      : 'absolute left-0 right-0'
                  }`}
                >
                  {workspaceModes.map((mode) => {
                    const active = effectiveWorkspace === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          setWorkspaceDropdownOpen(false);
                          onWorkspaceModeChange(mode.id);
                        }}
                        className={`w-full min-h-[38px] px-2.5 rounded-xl flex items-center justify-between gap-2 text-xs font-semibold cursor-pointer transition-colors ${
                          active
                            ? 'bg-[#1D1E23] text-white'
                            : 'text-[#505460] hover:bg-[#F6F7F9] hover:text-[#1A1B20]'
                        }`}
                      >
                        <span className="flex items-center gap-2 truncate">
                          {mode.icon}
                          <span className="truncate">{mode.label}</span>
                        </span>
                        {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Primary Navigation Items */}
          {navItems.length > 0 && (
            <nav aria-label="Primary desktop navigation" className="space-y-1.5">
              {navItems.map((item) => {
                const isActive = tabScreen === item.id;
                return (
                  <TooltipBubble
                    key={item.id}
                    fullWidth
                    content={item.label}
                    side="right"
                    disabled={!sidebarCollapsed}
                  >
                    <button
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      aria-label={item.label}
                      className={`relative w-full min-h-[44px] rounded-2xl flex items-center text-sm font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                        sidebarCollapsed ? 'justify-center px-0' : 'px-3 py-2.5'
                      } ${
                        isActive
                          ? 'tactile-dark text-white'
                          : 'text-[#505460] hover:bg-[#F2F4F7] hover:text-[#1A1B20]'
                      }`}
                    >
                      <span className="shrink-0 flex items-center justify-center">{item.icon}</span>
                      <span
                        className={`overflow-hidden transition-[max-width,opacity,margin] ${sbEase} ${
                          sidebarCollapsed ? 'max-w-0 w-0 opacity-0 ml-0' : 'max-w-[160px] opacity-100 ml-3'
                        }`}
                      >
                        {item.label}
                      </span>
                      {item.badge !== undefined && item.badge > 0 && !sidebarCollapsed && (
                        <span
                          className={`font-mono-tabular text-[11px] font-semibold px-1.5 py-0.5 rounded-md ml-auto transition-opacity ${sbEase} ${
                            isActive ? 'bg-white text-[#1D1E23]' : 'bg-[#1D1E23] text-white'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                      {item.badge !== undefined && item.badge > 0 && sidebarCollapsed && (
                        <span
                          className={`absolute top-1.5 right-3 min-w-[16px] h-[16px] px-1 rounded-full font-mono-tabular text-[9px] font-bold flex items-center justify-center ${
                            isActive ? 'bg-white text-[#1D1E23]' : 'bg-[#1D1E23] text-white'
                          }`}
                        >
                          {item.badge > 9 ? '9+' : item.badge}
                        </span>
                      )}
                    </button>
                  </TooltipBubble>
                );
              })}
            </nav>
          )}

          {/* School Admin Pages inside Dark Rounded-Edge Container */}
          {isSchoolAdminConsole && onSelectSchoolAdminSection && (
            <nav
              aria-label="School Admin pages"
              className="min-h-0 flex flex-col overflow-hidden rounded-2xl bg-[#1D1E23] border border-[#1D1E23] text-white shadow-[0_12px_28px_-14px_rgba(18,19,24,0.65)] p-2"
            >
              {!sidebarCollapsed && (
                <p className="shrink-0 px-2.5 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#A5AAB8]">
                  Admin Pages
                </p>
              )}
              <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto scroll-smooth overscroll-contain space-y-1">
                {schoolAdminPages.map((pg) => {
                  const isActive =
                    activeScreen === 'school_admin' && activeSchoolAdminSection === pg.id;
                  return (
                    <TooltipBubble
                      key={pg.id}
                      fullWidth
                      content={pg.label}
                      side="right"
                      disabled={!sidebarCollapsed}
                    >
                      <button
                        type="button"
                        onClick={() => handlePickSchoolAdminSection(pg.id)}
                        aria-label={pg.label}
                        className={`relative w-full min-h-[40px] rounded-xl flex items-center text-xs font-semibold transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                          sidebarCollapsed ? 'justify-center px-0' : 'px-2.5 py-2'
                        } ${
                          isActive
                            ? 'bg-white text-[#1D1E23] shadow-xs'
                            : 'text-[#C3C7D2] hover:bg-white/[0.12] hover:text-white'
                        }`}
                      >
                        <span className="shrink-0 flex items-center justify-center">{pg.icon}</span>
                        <span
                          className={`overflow-hidden transition-[max-width,opacity,margin] ${sbEase} ${
                            sidebarCollapsed
                              ? 'max-w-0 w-0 opacity-0 ml-0'
                              : 'max-w-[150px] opacity-100 ml-2.5'
                          }`}
                        >
                          {pg.label}
                        </span>
                      </button>
                    </TooltipBubble>
                  );
                })}
              </div>
            </nav>
          )}

          {/* Super Admin Pages inside Dark Rounded-Edge Container */}
          {isSuperAdminConsole && onSelectAdminSection && (
            <nav
              aria-label="Super Admin pages"
              className="min-h-0 flex flex-col overflow-hidden rounded-2xl bg-[#1D1E23] border border-[#1D1E23] text-white shadow-[0_12px_28px_-14px_rgba(18,19,24,0.65)] p-2"
            >
              {!sidebarCollapsed && (
                <p className="shrink-0 px-2.5 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#A5AAB8]">
                  Console Pages
                </p>
              )}
              <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto scroll-smooth overscroll-contain space-y-1">
                {superAdminPages.map((pg) => {
                  const isActive =
                    activeScreen === 'super_admin' && activeAdminSection === pg.id;
                  return (
                    <TooltipBubble
                      key={pg.id}
                      fullWidth
                      content={pg.label}
                      side="right"
                      disabled={!sidebarCollapsed}
                    >
                      <button
                        type="button"
                        onClick={() => handlePickSuperAdminSection(pg.id)}
                        aria-label={pg.label}
                        className={`relative w-full min-h-[40px] rounded-xl flex items-center text-xs font-semibold transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                          sidebarCollapsed ? 'justify-center px-0' : 'px-2.5 py-2'
                        } ${
                          isActive
                            ? 'bg-white text-[#1D1E23] shadow-xs'
                            : 'text-[#C3C7D2] hover:bg-white/[0.12] hover:text-white'
                        }`}
                      >
                        <span className="shrink-0 flex items-center justify-center">{pg.icon}</span>
                        <span
                          className={`overflow-hidden transition-[max-width,opacity,margin] ${sbEase} ${
                            sidebarCollapsed ? 'max-w-0 w-0 opacity-0 ml-0' : 'max-w-[150px] opacity-100 ml-2.5'
                          }`}
                        >
                          {pg.label}
                        </span>
                        {pg.badge !== undefined && pg.badge > 0 && !sidebarCollapsed && (
                          <span
                            className={`font-mono-tabular text-[10px] font-bold px-1.5 py-0.5 rounded-md ml-auto transition-opacity ${sbEase} ${
                              isActive ? 'bg-[#1D1E23] text-white' : 'bg-white text-[#1D1E23]'
                            }`}
                          >
                            {pg.badge}
                          </span>
                        )}
                        {pg.badge !== undefined && pg.badge > 0 && sidebarCollapsed && (
                          <span
                            className={`absolute top-1 right-1.5 min-w-[15px] h-[15px] px-1 rounded-full font-mono-tabular text-[9px] font-bold flex items-center justify-center ${
                              isActive ? 'bg-[#1D1E23] text-white' : 'bg-white text-[#1D1E23]'
                            }`}
                          >
                            {pg.badge > 9 ? '9+' : pg.badge}
                          </span>
                        )}
                      </button>
                    </TooltipBubble>
                  );
                })}
              </div>
            </nav>
          )}

          {/* Prominent Solid Subscription CTA (Hidden on isolated Admin Views) */}
          {showSubscriptionCta && (
            <TooltipBubble
              fullWidth
              content="View subscription plans and benefits"
              side="right"
              disabled={!sidebarCollapsed}
            >
              <button
                type="button"
                onClick={() => onOpenPaywall()}
                aria-label="Open subscription plans"
                className={`w-full rounded-2xl bg-[#1D1E23] text-white shadow-[0_10px_22px_-10px_rgba(18,19,24,0.55)] transition-all duration-150 hover:bg-[#2B2D35] active:scale-[0.98] cursor-pointer ${
                  sidebarCollapsed
                    ? 'min-h-[44px] px-3 py-2.5 flex items-center justify-center'
                    : 'p-3.5 text-left'
                }`}
              >
                <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between gap-2.5'}`}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-[#1D1E23]">
                      <Crown className="h-4 w-4" />
                    </span>
                    {!sidebarCollapsed && (
                      <div className="min-w-0">
                        <p className="font-display text-xs font-bold text-white truncate">
                          Subscription Plans
                        </p>
                        <p className="text-[11px] text-[#C3C7D2] truncate">
                          {renderSubscriptionSubline()}
                        </p>
                      </div>
                    )}
                  </div>
                  {!sidebarCollapsed && <ArrowUpRight className="h-4 w-4 shrink-0 text-[#C3C7D2]" />}
                </div>
              </button>
            </TooltipBubble>
          )}
        </div>

        {/* Bottom Settings + Verified Account Card & Sign Out */}
        <div className="shrink-0 space-y-2.5 pt-3 border-t border-[#1A1B20]/[0.07]">
          {isSuperAdminConsole && onSelectAdminSection && (
            <div ref={settingsPanelRef} className="relative">
              <TooltipBubble
                fullWidth
                content="Settings & UI Edits"
                side="right"
                disabled={!sidebarCollapsed}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (sidebarCollapsed) {
                      setSettingsPopoverOpen((prev) => !prev);
                    } else {
                      setSettingsMenuOpen((prev) => !prev);
                    }
                  }}
                  aria-expanded={sidebarCollapsed ? settingsPopoverVisible : settingsMenuOpen}
                  aria-label="Settings"
                  className={`w-full min-h-[44px] rounded-2xl flex items-center text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    sidebarCollapsed ? 'justify-center px-0' : 'justify-between px-3'
                  } ${
                    sidebarCollapsed &&
                    activeScreen === 'super_admin' &&
                    activeAdminSection === 'settings'
                      ? 'bg-[#1D1E23] text-white'
                      : 'bg-[#F6F7F9] text-[#1A1B20] hover:bg-[#ECEEF3]'
                  }`}
                >
                  <span className="flex items-center min-w-0">
                    <Settings className="w-[18px] h-[18px] shrink-0" />
                    <span
                      className={`overflow-hidden transition-[max-width,opacity,margin] ${sbEase} ${
                        sidebarCollapsed ? 'max-w-0 w-0 opacity-0 ml-0' : 'max-w-[140px] opacity-100 ml-2.5'
                      }`}
                    >
                      Settings
                    </span>
                  </span>
                  {!sidebarCollapsed && (
                    <ChevronDown
                      className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                        settingsMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </button>
              </TooltipBubble>

              {/* Expanded sidebar Settings dropdown -> direct UI Edits item (no nested dropdown) */}
              {!sidebarCollapsed && settingsMenuOpen && (
                <div className="mt-1.5 rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] p-1.5 page-enter">
                  <button
                    type="button"
                    onClick={handleOpenUiEditsPage}
                    className={`w-full min-h-[38px] px-2.5 rounded-xl flex items-center gap-2 text-xs font-semibold cursor-pointer transition-colors ${
                      activeScreen === 'super_admin' && activeAdminSection === 'settings'
                        ? 'bg-[#1D1E23] text-white'
                        : 'text-[#3A3D47] hover:bg-white hover:text-[#1A1B20]'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">UI Edits</span>
                  </button>
                </div>
              )}

              {/* Collapsed sidebar pop-out for Settings -> direct UI Edits item */}
              {settingsPopoverVisible && (
                <div
                  role="dialog"
                  aria-label="Settings"
                  className="absolute bottom-0 left-full ml-[30px] w-52 rounded-2xl bg-white border border-[#1A1B20]/[0.1] shadow-[0_18px_40px_-14px_rgba(18,19,24,0.38)] p-2.5 space-y-1.5 z-50 page-enter"
                >
                  <p className="px-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#686C78]">
                    Settings
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenUiEditsPage}
                    className={`w-full min-h-[38px] px-2.5 rounded-xl flex items-center gap-2 text-xs font-semibold cursor-pointer transition-colors ${
                      activeScreen === 'super_admin' && activeAdminSection === 'settings'
                        ? 'bg-[#1D1E23] text-white'
                        : 'text-[#3A3D47] hover:bg-[#F6F7F9] hover:text-[#1A1B20]'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">UI Edits</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <div ref={userPanelRef} className="relative">
            <div
              className={`rounded-2xl flex items-center transition-[padding,background-color] ${sbEase} ${
                sidebarCollapsed ? 'justify-center p-1 bg-transparent' : 'p-3 bg-[#F6F7F9]'
              }`}
            >
              <button
                type="button"
                onClick={() => sidebarCollapsed && setUserPopoverOpen((open) => !open)}
                aria-label={sidebarCollapsed ? 'Show account details' : student.fullName}
                aria-haspopup={sidebarCollapsed ? 'dialog' : undefined}
                aria-expanded={sidebarCollapsed ? userPopoverVisible : undefined}
                tabIndex={sidebarCollapsed ? 0 : -1}
                className={`h-9 w-9 rounded-full tactile-dark text-white text-xs font-bold flex items-center justify-center shrink-0 transition-transform duration-150 ${
                  sidebarCollapsed ? 'cursor-pointer active:scale-95' : 'cursor-default'
                }`}
              >
                {initials}
              </button>
              <div
                className={`min-w-0 overflow-hidden transition-[max-width,opacity,margin] ${sbEase} ${
                  sidebarCollapsed ? 'max-w-0 opacity-0 ml-0' : 'max-w-[150px] opacity-100 ml-2.5'
                }`}
              >
                <p className="text-xs font-bold text-[#1A1B20] truncate">{student.fullName}</p>
                <p className="text-[11px] font-mono-tabular text-[#686C78] truncate">
                  {student.role === 'student' ? student.matricNumber : roleBadgeLabel}
                </p>
              </div>
            </div>

            <div
              className={`transition-[max-height,opacity,margin] ${sbEase} ${
                sidebarCollapsed
                  ? 'max-h-0 opacity-0 mt-0 overflow-hidden pointer-events-none'
                  : 'max-h-14 opacity-100 mt-2'
              }`}
              aria-hidden={sidebarCollapsed}
            >
              <button
                type="button"
                disabled={isSigningOut}
                onClick={handleSignOutClick}
                tabIndex={sidebarCollapsed ? -1 : 0}
                className="w-full min-h-[44px] rounded-2xl bg-white border border-[#1A1B20]/[0.08] text-sm font-semibold text-[#1A1B20] hover:bg-[#1D1E23] hover:text-white flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <LogOut className="w-4 h-4" />
                <span>{isSigningOut ? 'Signing out…' : 'Sign out'}</span>
              </button>
            </div>

            {/* Collapsed pop-out */}
            <div
              role="dialog"
              aria-label="Account details"
              aria-hidden={!userPopoverVisible}
              className={`absolute bottom-0 left-full ml-[30px] w-60 origin-bottom-left rounded-2xl bg-white border border-[#1A1B20]/[0.08] shadow-[0_18px_40px_-14px_rgba(18,19,24,0.38)] p-3 transition-[opacity,transform] ${sbEase} ${
                userPopoverVisible
                  ? 'opacity-100 scale-100 translate-x-0'
                  : 'opacity-0 scale-95 -translate-x-2 pointer-events-none'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0 rounded-xl bg-[#F6F7F9] p-3">
                <div className="h-9 w-9 rounded-full tactile-dark text-white text-xs font-bold flex items-center justify-center shrink-0">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#1A1B20] truncate">{student.fullName}</p>
                  <p className="text-[11px] font-mono-tabular text-[#686C78] truncate">
                    {student.matricNumber}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSigningOut}
                tabIndex={userPopoverVisible ? 0 : -1}
                onClick={() => {
                  setUserPopoverOpen(false);
                  handleSignOutClick();
                }}
                className="mt-2 w-full min-h-[44px] rounded-xl bg-white border border-[#1A1B20]/[0.08] text-sm font-semibold text-[#1A1B20] hover:bg-[#1D1E23] hover:text-white flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <LogOut className="w-4 h-4" />
                <span>{isSigningOut ? 'Signing out…' : 'Sign out'}</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Mobile & Tablet Fixed Top Bar */}
        <header
          className={`lg:hidden fixed top-0 inset-x-0 z-40 h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] px-4 sm:px-6 flex items-center justify-between transition-colors duration-250 ease-out ${
            isScrolled
              ? 'bg-[#1D1E23] text-white shadow-[0_6px_18px_-6px_rgba(14,15,20,0.42)]'
              : hasBanner
              ? 'bg-transparent text-white'
              : 'bg-[#F6F7F9] text-[#1D1E23] border-b border-[#1A1B20]/[0.06]'
          }`}
        >
          <button
            type="button"
            onClick={handleLogoHomeClick}
            aria-label="pqguide home"
            className="min-h-[40px] min-w-[40px] flex items-center justify-start cursor-pointer transition-transform duration-150 active:scale-95"
          >
            <BrandLogo className="w-9" />
          </button>

          <div className="flex items-center gap-0.5">
            <TooltipBubble
              content={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
              side="bottom"
            >
              <button
                type="button"
                onClick={() => onNavigate('notifications')}
                aria-label={`Open notifications (${unreadCount} unread)`}
                className={`relative h-10 w-10 rounded-full flex items-center justify-center cursor-pointer transition-opacity duration-150 active:opacity-70 ${
                  hasBanner || isScrolled
                    ? 'text-white'
                    : 'text-[#1D1E23]'
                }`}
              >
                <span className="relative inline-flex items-center justify-center">
                  <Bell className="w-[21px] h-[21px]" strokeWidth={2} />
                  {unreadCount > 0 && (
                    <span
                      className={`absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold font-mono-tabular flex items-center justify-center ${
                        hasBanner || isScrolled
                          ? 'bg-white text-[#1D1E23]'
                          : 'bg-[#1D1E23] text-white'
                      }`}
                    >
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </span>
              </button>
            </TooltipBubble>

            <TooltipBubble content="Open menu" side="bottom">
              <button
                type="button"
                aria-label="Open navigation menu"
                aria-expanded={drawerOpen}
                aria-controls="mobile-slide-drawer"
                onClick={() => setDrawerOpen(true)}
                className={`h-10 w-10 -mr-1.5 rounded-full flex items-center justify-center cursor-pointer transition-opacity duration-150 active:opacity-70 ${
                  hasBanner || isScrolled
                    ? 'text-white'
                    : 'text-[#1D1E23]'
                }`}
              >
                <MoreVertical className="w-[21px] h-[21px]" strokeWidth={2} />
              </button>
            </TooltipBubble>
          </div>
        </header>

        {/* Desktop 3-Zone Top Bar (Workspace switcher consolidated into sidebar dropdown) */}
        <header
          className="hidden lg:flex items-center justify-between gap-8 px-8 py-4 bg-white border-b border-[#1A1B20]/[0.06] sticky top-0 z-30"
        >
          <nav aria-label="Company links" className="flex items-center gap-7 text-sm font-medium">
            {infoLinks.map((item) => {
              const active = activeScreen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    onBanner
                      ? active
                        ? 'text-white font-semibold'
                        : 'text-white/75 hover:text-white'
                      : active
                        ? 'text-[#1A1B20] font-semibold'
                        : 'text-[#5A5E6B] hover:text-[#1A1B20]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <TooltipBubble
              content={
                unreadCount > 0
                  ? `View notifications (${unreadCount} unread)`
                  : 'Open notifications feed'
              }
              side="bottom"
            >
              <button
                type="button"
                onClick={() => onNavigate('notifications')}
                aria-label={`Open notifications (${unreadCount} unread)`}
                className={`relative min-h-[40px] px-3 rounded-xl flex items-center gap-2 border text-xs font-semibold transition-transform duration-150 active:scale-95 cursor-pointer ${
                  activeScreen === 'notifications'
                    ? 'tactile-dark text-white border-transparent'
                    : onBanner
                      ? 'bg-white/10 hover:bg-white/20 text-white border-white/20'
                      : 'bg-[#F6F7F9] hover:bg-[#ECEEF3] text-[#1D1E23] border-[#1A1B20]/[0.08]'
                }`}
              >
                <Bell className="w-4 h-4 shrink-0" />
                <span>Notifications</span>
                {unreadCount > 0 && (
                  <span
                    className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold font-mono-tabular flex items-center justify-center ${
                      activeScreen === 'notifications'
                        ? 'bg-white text-[#1D1E23]'
                        : 'bg-[#1D1E23] text-white'
                    }`}
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            </TooltipBubble>

            <TooltipBubble content="Open account details and sign out" side="bottom">
              <button
                ref={desktopTriggerRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                aria-label="Open account menu"
                onClick={() => setAccountMenuOpen((prev) => !prev)}
                className={`min-h-[40px] px-2.5 rounded-xl flex items-center gap-2 border transition-colors cursor-pointer ${
                  accountMenuOpen
                    ? 'tactile-dark text-white border-transparent'
                    : onBanner
                      ? 'bg-white/10 hover:bg-white/20 text-white border-white/20'
                      : 'bg-[#F6F7F9] hover:bg-[#ECEEF3] text-[#1D1E23] border-[#1A1B20]/[0.08]'
                }`}
              >
                <User className="w-4 h-4 shrink-0" />
                <span className="text-xs font-semibold max-w-[110px] truncate">
                  {student.fullName.split(' ')[0]}
                </span>
              </button>
            </TooltipBubble>
          </div>
        </header>

        {/* Live Super Admin Broadcast Header Marquee (Desktop Top Ribbon) */}
        {showMarquee && marquee && (
          <div
            role="region"
            aria-label="Platform broadcast notice"
            className={`hidden lg:flex items-center gap-3 px-8 py-2 text-xs font-semibold overflow-hidden ${marqueeToneClass}`}
          >
            <Megaphone className="w-3.5 h-3.5 shrink-0 opacity-90" />
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="animate-marquee-x whitespace-nowrap">
                {marquee.message}
              </div>
            </div>
          </div>
        )}

        {/* Super Admin Preview Return Strip */}
        {isSuperAdmin && effectiveWorkspace !== 'super_admin' && onWorkspaceModeChange && (
          <div className="hidden lg:flex items-center justify-between gap-4 px-8 py-2 bg-[#ECEEF3] border-b border-[#1A1B20]/[0.08] text-xs">
            <div className="flex items-center gap-2 font-semibold text-[#1A1B20]">
              <PreviewEye className="w-3.5 h-3.5 text-[#1D1E23]" />
              <span>
                Super Admin View:{' '}
                {effectiveWorkspace === 'school_admin'
                  ? 'School Admin Interface'
                  : 'Student Website (Infinity Plan Unlocked)'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onWorkspaceModeChange('super_admin')}
              className="px-3 py-1 rounded-lg bg-[#1D1E23] text-white font-semibold hover:bg-[#2B2D35] cursor-pointer inline-flex items-center gap-1.5"
            >
              <PreviewOff className="w-3.5 h-3.5" />
              <span>Back to Super Admin Desk</span>
            </button>
          </div>
        )}

        {/* Desktop Student Account Popover */}
        {accountMenuOpen && (
          <div
            ref={accountMenuRef}
            role="menu"
            aria-label="Student account menu"
            className="hidden lg:block fixed top-[72px] right-8 z-50 w-72 rounded-2xl bg-white border border-[#1A1B20]/[0.09] shadow-[0_24px_48px_-12px_rgba(20,21,26,0.28)] p-4 space-y-3.5 page-enter"
          >
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-full tactile-dark text-white text-sm font-bold flex items-center justify-center shrink-0">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[#1A1B20] truncate">
                  {student.fullName}
                </p>
                <p className="text-xs font-mono-tabular text-[#686C78] truncate">
                  {student.role === 'student' ? student.matricNumber : roleBadgeLabel}
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-[#F6F7F9] px-3 py-2.5 space-y-1 text-xs">
              <p className="font-semibold text-[#1A1B20] truncate">
                {student.department}
              </p>
              <p className="text-[#686C78] truncate">{student.faculty}</p>
              <p className="text-[#686C78] truncate">{student.email}</p>
            </div>

            <TactileButton
              type="button"
              variant="dark"
              size="md"
              fullWidth
              className="rounded-full"
              icon={<LogOut className="w-4 h-4" />}
              loading={isSigningOut}
              disabled={isSigningOut}
              onClick={handleSignOutClick}
            >
              Sign out
            </TactileButton>
          </div>
        )}

        {/* Mobile & Tablet Slide-Out Navigation Drawer */}
        <div
          aria-hidden={!drawerOpen}
          className={`lg:hidden fixed inset-0 z-50 flex justify-end transition-opacity duration-200 ${
            drawerOpen
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          <div
            onClick={() => setDrawerOpen(false)}
            style={
              isSwipingDrawer
                ? {
                    opacity: Math.max(
                      0,
                      1 - swipeOffsetX / (drawerPanelRef.current?.offsetWidth || 300)
                    ),
                  }
                : undefined
            }
            className="absolute inset-0 bg-[#121318]/55 transition-opacity duration-150"
          />

          <aside
            ref={drawerPanelRef}
            id="mobile-slide-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation menu"
            onTouchStart={handleDrawerTouchStart}
            onTouchMove={handleDrawerTouchMove}
            onTouchEnd={handleDrawerTouchEnd}
            onTouchCancel={handleDrawerTouchEnd}
            style={
              isSwipingDrawer
                ? { transform: `translate3d(${swipeOffsetX}px, 0, 0)` }
                : undefined
            }
            className={`relative h-full w-[84vw] max-w-[320px] bg-white shadow-[-16px_0_48px_-12px_rgba(14,15,20,0.38)] flex flex-col justify-between overflow-y-auto ash-scroll touch-pan-y ${
              isSwipingDrawer
                ? 'transition-none'
                : 'transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]'
            } ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
          >
            <div className="p-5 space-y-5">
              {/* Brand Header + Close Button */}
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    handleLogoHomeClick();
                    setDrawerOpen(false);
                  }}
                  className="flex flex-col items-start gap-1.5 text-left cursor-pointer min-w-0"
                >
                  <BrandLockup className="h-8 w-auto text-[#1A1B20]" />
                  <span className="block text-xs text-[#686C78] truncate">
                    {isSchoolAdmin
                      ? `School Admin · ${student.assignedSchoolCode ?? 'AAUA'}`
                      : isSuperAdmin
                        ? 'Super Admin Workspace'
                        : 'University Exam Home'}
                  </span>
                </button>

                <TooltipBubble content="Close menu" side="left">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Close navigation menu"
                    className="min-h-[44px] min-w-[44px] rounded-2xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-[#1A1B20] flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </TooltipBubble>
              </div>

              {/* Account Card */}
              <div className="rounded-2xl bg-[#F6F7F9] p-3.5 space-y-2.5">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-full tactile-dark text-white text-sm font-bold flex items-center justify-center shrink-0">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-[#1A1B20] truncate">
                      {student.fullName}
                    </p>
                    <p className="text-xs font-mono-tabular text-[#686C78] truncate">
                      {student.role === 'student' ? student.matricNumber : roleBadgeLabel}
                    </p>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#1A1B20]/[0.06] space-y-0.5 text-xs">
                  <p className="font-semibold text-[#1A1B20] truncate">
                    {student.department}
                  </p>
                  <p className="text-[#686C78] truncate">{student.faculty}</p>
                  <p className="text-[#686C78] truncate">{student.email}</p>
                </div>
              </div>

              {/* Active Workspace Dropdown (Mobile Drawer) */}
              {isSuperAdmin && onWorkspaceModeChange && (
                <CustomSelect
                  id="mobile-workspace-select"
                  label="Active Workspace"
                  labelClassName="block px-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#686C78] mb-1"
                  tone="dark"
                  value={effectiveWorkspace}
                  options={workspaceModes.map((m) => ({
                    value: m.id,
                    label: m.label,
                  }))}
                  onChange={(val) => {
                    onWorkspaceModeChange(val as WorkspaceViewMode);
                    setDrawerOpen(false);
                  }}
                />
              )}

              {/* Primary Navigation Links */}
              {navItems.length > 0 && (
                <nav aria-label="Mobile drawer navigation" className="space-y-1">
                  {navItems.map((item) => {
                    const isActive = tabScreen === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onNavigate(item.id);
                          setDrawerOpen(false);
                        }}
                        className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-2xl flex items-center justify-between text-sm font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                          isActive
                            ? 'tactile-dark text-white'
                            : 'text-[#505460] hover:bg-[#F2F4F7] hover:text-[#1A1B20]'
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          {item.icon}
                          <span>{item.label}</span>
                        </span>
                        {item.badge !== undefined && item.badge > 0 && (
                          <span
                            className={`font-mono-tabular text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${
                              isActive
                                ? 'bg-white text-[#1D1E23]'
                                : 'bg-[#1D1E23] text-white'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </nav>
              )}

              {/* School Admin Pages inside Dark Rounded Container (Mobile Drawer) */}
              {isSchoolAdminConsole && onSelectSchoolAdminSection && (
                <nav
                  aria-label="School Admin mobile pages"
                  className="rounded-2xl bg-[#1D1E23] border border-[#1D1E23] text-white p-2 space-y-1 shadow-[0_12px_28px_-14px_rgba(18,19,24,0.65)]"
                >
                  <p className="px-2 pt-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#A5AAB8]">
                    Admin Pages
                  </p>
                  {schoolAdminPages.map((pg) => {
                    const active =
                      activeScreen === 'school_admin' && activeSchoolAdminSection === pg.id;
                    return (
                      <button
                        key={pg.id}
                        type="button"
                        onClick={() => {
                          handlePickSchoolAdminSection(pg.id);
                          setDrawerOpen(false);
                        }}
                        className={`w-full min-h-[40px] px-3 rounded-xl flex items-center gap-2.5 text-xs font-semibold cursor-pointer transition-colors ${
                          active
                            ? 'bg-white text-[#1D1E23] shadow-xs'
                            : 'text-[#C3C7D2] hover:bg-white/[0.12] hover:text-white'
                        }`}
                      >
                        {pg.icon}
                        <span>{pg.label}</span>
                      </button>
                    );
                  })}
                </nav>
              )}

              {/* Super Admin Console Pages inside Dark Rounded Container (Mobile Drawer) */}
              {isSuperAdminConsole && onSelectAdminSection && (
                <nav
                  aria-label="Super Admin mobile console pages"
                  className="max-h-[46dvh] flex flex-col overflow-hidden rounded-2xl bg-[#1D1E23] border border-[#1D1E23] text-white p-2 shadow-[0_12px_28px_-14px_rgba(18,19,24,0.65)]"
                >
                  <p className="shrink-0 px-2 pt-0.5 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#A5AAB8]">
                    Console Pages
                  </p>
                  <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto scroll-smooth overscroll-contain space-y-1">
                    {superAdminPages.map((pg) => {
                      const active =
                        activeScreen === 'super_admin' && activeAdminSection === pg.id;
                      return (
                        <button
                          key={pg.id}
                          type="button"
                          onClick={() => {
                            handlePickSuperAdminSection(pg.id);
                            setDrawerOpen(false);
                          }}
                          className={`w-full min-h-[40px] px-3 rounded-xl flex items-center justify-between text-xs font-semibold cursor-pointer transition-colors ${
                            active
                              ? 'bg-white text-[#1D1E23] shadow-xs'
                              : 'text-[#C3C7D2] hover:bg-white/[0.12] hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            {pg.icon}
                            <span>{pg.label}</span>
                          </span>
                          {pg.badge !== undefined && pg.badge > 0 && (
                            <span
                              className={`font-mono-tabular text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                active ? 'bg-[#1D1E23] text-white' : 'bg-white text-[#1D1E23]'
                              }`}
                            >
                              {pg.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="shrink-0 pt-1.5 mt-1.5 border-t border-white/[0.1] space-y-1">
                    <button
                      type="button"
                      onClick={() => setMobileSettingsExpanded((prev) => !prev)}
                      aria-expanded={mobileSettingsExpanded}
                      className="w-full min-h-[40px] px-3 rounded-xl flex items-center justify-between gap-2 text-xs font-semibold cursor-pointer transition-colors text-[#C3C7D2] hover:bg-white/[0.12] hover:text-white"
                    >
                      <span className="flex items-center gap-2.5">
                        <Settings className="w-4 h-4" />
                        <span>Settings</span>
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 transition-transform duration-200 ${
                          mobileSettingsExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {mobileSettingsExpanded && (
                      <div className="rounded-xl bg-white/[0.06] p-1">
                        <button
                          type="button"
                          onClick={() => {
                            handleOpenUiEditsPage();
                            setDrawerOpen(false);
                          }}
                          className={`w-full min-h-[36px] px-2.5 rounded-lg flex items-center gap-2 text-xs font-semibold cursor-pointer transition-colors ${
                            activeScreen === 'super_admin' && activeAdminSection === 'settings'
                              ? 'bg-white text-[#1D1E23]'
                              : 'text-[#D6DAE4] hover:bg-white/[0.1] hover:text-white'
                          }`}
                        >
                          <Layers className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">UI Edits</span>
                        </button>
                      </div>
                    )}
                  </div>
                </nav>
              )}

              {/* Company links */}
              <nav
                aria-label="About and support"
                className="space-y-1 pt-4 border-t border-[#1A1B20]/[0.07]"
              >
                {infoLinks.map((item) => {
                  const isActive = activeScreen === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onNavigate(item.id);
                        setDrawerOpen(false);
                      }}
                      className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-2xl flex items-center gap-3 text-sm font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                        isActive
                          ? 'tactile-dark text-white'
                          : 'text-[#505460] hover:bg-[#F2F4F7] hover:text-[#1A1B20]'
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              {showSubscriptionCta && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      onOpenPaywall();
                    }}
                    aria-label="Open subscription plans"
                    className="w-full rounded-2xl bg-[#1D1E23] p-3.5 text-left text-white shadow-[0_10px_22px_-10px_rgba(18,19,24,0.55)] transition-all duration-150 hover:bg-[#2B2D35] active:scale-[0.98] cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#1D1E23]">
                          <Crown className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-display text-sm font-bold text-white truncate">
                            Subscription Plans
                          </p>
                          <p className="text-xs text-[#C3C7D2] truncate">
                            {renderSubscriptionSubline()}
                          </p>
                        </div>
                      </div>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-[#C3C7D2]" />
                    </div>
                  </button>
                </div>
              )}
            </div>

            <div className="p-5 pt-4 border-t border-[#1A1B20]/[0.07] pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
              <TactileButton
                type="button"
                variant="dark"
                size="md"
                fullWidth
                className="rounded-full min-h-[46px]"
                icon={<LogOut className="w-4 h-4" />}
                loading={isSigningOut}
                disabled={isSigningOut}
                onClick={handleSignOutClick}
              >
                Sign out
              </TactileButton>
            </div>
          </aside>
        </div>

        {/* Scrollable Content */}
        <main
          className={`flex-1 w-full mx-auto ${showStudentBottomBar ? 'pb-24' : 'pb-10'} ${
            hasBanner
              ? 'max-w-6xl px-4 sm:px-6 lg:px-8 pt-0 lg:pt-8 lg:pb-8'
              : 'max-w-6xl px-4 sm:px-6 lg:px-8 pt-[calc(68px+env(safe-area-inset-top))] lg:pt-8 lg:pb-8'
          }`}
        >
          {/* Mobile Marquee Banner */}
          {showMarquee && marquee && (
            <div
              role="region"
              aria-label="Platform broadcast notice"
              className={`lg:hidden mb-3 rounded-xl px-3.5 py-2 text-xs font-semibold flex items-center gap-2.5 overflow-hidden ${
                hasBanner ? 'mt-[calc(64px+env(safe-area-inset-top))]' : ''
              } ${marqueeToneClass}`}
            >
              <Megaphone className="w-3.5 h-3.5 shrink-0" />
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="animate-marquee-x whitespace-nowrap">
                  {marquee.message}
                </div>
              </div>
            </div>
          )}

          {isSuperAdmin && effectiveWorkspace !== 'super_admin' && onWorkspaceModeChange && (
            <div
              className={`lg:hidden mb-3 rounded-xl bg-[#ECEEF3] border border-[#1A1B20]/10 px-3.5 py-2 flex items-center justify-between gap-2 text-xs ${
                hasBanner && !showMarquee ? 'mt-[calc(64px+env(safe-area-inset-top))]' : ''
              }`}
            >
              <span className="font-semibold text-[#1A1B20] truncate">
                {effectiveWorkspace === 'school_admin'
                  ? 'School Admin View'
                  : 'Student Site · Infinity Unlocked'}
              </span>
              <button
                type="button"
                onClick={() => onWorkspaceModeChange('super_admin')}
                className="px-2.5 py-1 rounded-lg bg-[#1D1E23] text-white font-semibold shrink-0 cursor-pointer"
              >
                Return to Super Admin
              </button>
            </div>
          )}

          {isRestrictedAccount(student) && (
            <div
              role="alert"
              className="mb-4 rounded-2xl bg-[#FEF3C7] border border-[#F59E0B]/40 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#92400E]"
            >
              <div>
                <span className="font-bold">Account Restricted:</span>{' '}
                <span>
                  {student.moderationNote
                    ? student.moderationNote
                    : 'Interactive submissions and uploads are paused while your account is in read-only mode.'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('support')}
                className="px-3 py-1 rounded-lg bg-[#92400E] text-white font-semibold cursor-pointer shrink-0"
              >
                Contact Support
              </button>
            </div>
          )}

          {children}
        </main>
      </div>

      {/* Mobile Bottom Tab Footer */}
      {showStudentBottomBar && (
        <nav
          aria-label="Mobile bottom navigation"
          className={`lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#1D1E23] border-t border-white/[0.08] pb-safe transition-transform duration-200 ${
            keyboardOpen ? 'translate-y-[calc(100%+24px)] pointer-events-none' : ''
          }`}
          aria-hidden={keyboardOpen || undefined}
        >
          <div className="grid grid-cols-5 items-center h-[52px] max-w-lg mx-auto px-2">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
                tabScreen === 'home'
                  ? 'text-white font-semibold'
                  : 'text-[#9CA0AE]'
              }`}
            >
              <Home className="w-5 h-5" />
              <span className="text-[10px] leading-none">Home</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('past_questions')}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
                tabScreen === 'past_questions'
                  ? 'text-white font-semibold'
                  : 'text-[#9CA0AE]'
              }`}
            >
              <FileText className="w-5 h-5" />
              <span className="text-[10px] leading-none">PQs</span>
            </button>

            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={onQuickFind}
                aria-label="Quick find past question"
                className="-mt-5 h-12 w-12 rounded-full bg-white text-[#1D1E23] shadow-[0_6px_16px_-4px_rgba(0,0,0,0.5)] flex items-center justify-center ring-4 ring-[#1D1E23] transition-transform duration-150 active:scale-90 cursor-pointer"
              >
                <Search className="w-5 h-5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => onNavigate('materials')}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
                tabScreen === 'materials'
                  ? 'text-white font-semibold'
                  : 'text-[#9CA0AE]'
              }`}
            >
              <Folder className="w-5 h-5" />
              <span className="text-[10px] leading-none">Materials</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('mock_exam')}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
                activeScreen === 'mock_exam' ? 'text-white font-semibold' : 'text-[#9CA0AE]'
              }`}
            >
              <ClipboardCheck className="w-5 h-5" />
              <span className="text-[10px] leading-none">Exam</span>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
};
