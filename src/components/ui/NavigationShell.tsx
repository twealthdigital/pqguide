import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  ChevronLeft,
  FileText,
  Folder,
  Headphones,
  HelpCircle,
  Home,
  Info,
  Layers,
  LogOut,
  MoreVertical,
  Search,
  ShieldCheck,
  UploadCloud,
  User,
  X,
} from 'lucide-react';
import type {
  AppScreen,
  StudentAccount,
  UserRole,
} from '../../core/types';
import { CustomSelect } from './CustomSelect';
import { BrandLockup } from './BrandLockup';
import { BrandLogo } from './BrandLogo';
import { TactileButton } from './TactileButton';

interface NavigationShellProps {
  activeScreen: AppScreen;
  /** Screen Back returns to; keeps the right tab lit while a paper/guide is open. */
  parentScreen?: AppScreen;
  onNavigate: (screen: AppScreen) => void;
  onQuickFind: () => void;
  unreadCount: number;
  activeRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  student: StudentAccount;
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
  onNavigate,
  onQuickFind,
  unreadCount,
  activeRole,
  onRoleChange,
  student,
  onSignOut,
  children,
}) => {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('pqguide:sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [swipeOffsetX, setSwipeOffsetX] = useState(0);
  const [isSwipingDrawer, setIsSwipingDrawer] = useState(false);

  const desktopTriggerRef = useRef<HTMLButtonElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const userPanelRef = useRef<HTMLDivElement | null>(null);
  const drawerPanelRef = useRef<HTMLElement | null>(null);
  const signOutTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const gestureAxisRef = useRef<'pending' | 'horizontal' | 'vertical' | null>(null);

  const initials = getStudentInitials(student.fullName);

  // The bottom bar must stay at the bottom of the screen. When the on-screen
  // keyboard opens, some browsers shrink the viewport and drag fixed bars up
  // above the keyboard. Slide the bar down behind the keyboard instead.
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

      // Immediately yield to native vertical scroll on any vertical or leftward motion
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

  const tabScreen: AppScreen =
    activeScreen === 'reader'
      ? parentScreen
      : activeScreen === 'material_reader'
        ? 'materials'
        : activeScreen;

  const navItems: Array<{
    id: AppScreen;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    { id: 'home', label: 'Archive', icon: <Home className="w-5 h-5" /> },
    { id: 'past_questions', label: 'Past Questions', icon: <FileText className="w-5 h-5" /> },
    { id: 'materials', label: 'Materials', icon: <Folder className="w-5 h-5" /> },
    { id: 'school_admin', label: 'School Admin', icon: <UploadCloud className="w-5 h-5" /> },
    { id: 'super_admin', label: 'Super Admin', icon: <ShieldCheck className="w-5 h-5" /> },
  ];

  // Company links: top bar on desktop, side panel on mobile and tablet.
  const infoLinks: Array<{ id: AppScreen; label: string; icon: React.ReactNode }> = [
    { id: 'about', label: 'About', icon: <Info className="w-5 h-5" /> },
    { id: 'services', label: 'Services', icon: <Layers className="w-5 h-5" /> },
    { id: 'help', label: 'Help', icon: <HelpCircle className="w-5 h-5" /> },
    { id: 'support', label: 'Customer Support', icon: <Headphones className="w-5 h-5" /> },
  ];

  const onBanner = false;

  const userPopoverVisible = sidebarCollapsed && userPopoverOpen;

  // Collapsed side panel: the avatar opens a pop-out with the user's details.
  useEffect(() => {
    if (!sidebarCollapsed) setUserPopoverOpen(false);
  }, [sidebarCollapsed]);

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

  return (
    <div className="min-h-[100dvh] bg-[#F6F7F9] text-[#1A1B20] flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar */}
      <aside
        data-collapsed={sidebarCollapsed}
        className={`hidden lg:flex lg:flex-col lg:shrink-0 bg-white border-r border-[#1A1B20]/[0.07] p-5 sticky top-0 z-40 h-screen justify-between transition-[width] ${sbEase} ${
          sidebarCollapsed ? 'lg:w-[84px]' : 'lg:w-64'
        }`}
      >
        {/* Edge toggle: collapse / expand the side panel */}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand side panel' : 'Collapse side panel'}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? 'Expand' : 'Collapse'}
          className="absolute -right-3.5 top-[88px] z-50 h-7 w-7 rounded-full bg-white border border-[#1A1B20]/[0.1] text-[#1D1E23] shadow-[0_4px_12px_-4px_rgba(18,19,24,0.3)] flex items-center justify-center cursor-pointer hover:bg-[#1D1E23] hover:text-white active:scale-95 transition-colors duration-150"
        >
          <ChevronLeft
            className={`w-4 h-4 transition-transform ${sbEase} ${sidebarCollapsed ? 'rotate-180' : ''}`}
          />
        </button>

        <div className="space-y-7">
          <button
            type="button"
            onClick={() => onNavigate('home')}
            aria-label="pqguide home"
            className="block w-full text-left cursor-pointer group"
          >
            <span className="relative block h-11 w-full overflow-hidden">
              <BrandLockup
                className={`absolute left-0 top-1/2 h-9 w-auto -translate-y-1/2 origin-left text-[#1A1B20] transition-[opacity,transform] ${sbEase} ${
                  sidebarCollapsed ? 'opacity-0 scale-75 pointer-events-none' : 'opacity-100 scale-100'
                }`}
              />
              <span
                aria-hidden="true"
                className={`absolute left-0 top-1/2 h-11 w-11 -translate-y-1/2 rounded-[14px] bg-[#1D1E23] text-white flex items-center justify-center transition-[opacity,transform] ${sbEase} ${
                  sidebarCollapsed ? 'opacity-100 scale-100' : 'opacity-0 scale-75 pointer-events-none'
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
              University Exam Archive
            </span>
          </button>

          <nav aria-label="Primary desktop navigation" className="space-y-1.5">
            {navItems.map((item) => {
              const isActive =
                tabScreen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  title={sidebarCollapsed ? item.label : undefined}
                  aria-label={item.label}
                  className={`relative w-full min-h-[44px] px-3 py-2.5 rounded-2xl flex items-center text-sm font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'tactile-dark text-white'
                      : 'text-[#505460] hover:bg-[#F2F4F7] hover:text-[#1A1B20]'
                  }`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span
                    className={`overflow-hidden transition-[max-width,opacity,margin] ${sbEase} ${
                      sidebarCollapsed ? 'max-w-0 opacity-0 ml-0' : 'max-w-[160px] opacity-100 ml-3'
                    }`}
                  >
                    {item.label}
                  </span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span
                      className={`font-mono-tabular text-[11px] font-semibold px-1.5 py-0.5 rounded-md ml-auto transition-opacity ${sbEase} ${
                        sidebarCollapsed ? 'opacity-0 w-0 px-0 overflow-hidden' : 'opacity-100'
                      } ${isActive ? 'bg-white text-[#1D1E23]' : 'bg-[#1D1E23] text-white'}`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Workspace Switcher & Student Sign Out */}
        <div className="space-y-3 pt-4 border-t border-[#1A1B20]/[0.07]">
          <div
            className={`transition-[max-height,opacity] ${sbEase} ${
              sidebarCollapsed
                ? 'max-h-0 opacity-0 overflow-hidden pointer-events-none'
                : 'max-h-28 opacity-100'
            }`}
            aria-hidden={sidebarCollapsed}
          >
          <CustomSelect
            id="desktop-role-select"
            label="Active Workspace View"
            size="sm"
            menuPlacement="top"
            value={activeRole}
            options={[
              { value: 'student', label: 'Student View' },
              { value: 'school_admin', label: 'School Admin View' },
              { value: 'super_admin', label: 'Super Admin View' },
            ]}
            onChange={(val) => {
              const role = val as UserRole;
              onRoleChange(role);
              if (role === 'school_admin') onNavigate('school_admin');
              else if (role === 'super_admin') onNavigate('super_admin');
              else onNavigate('home');
            }}
          />
          </div>

          <div ref={userPanelRef} className="relative">
            {/* Account card (expanded: name + matric; collapsed: avatar only, opens the pop-out) */}
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
                  {student.matricNumber}
                </p>
              </div>
            </div>

            {/* Sign out: icon + text, sits under the account card */}
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

            {/* Collapsed pop-out: slides out beside the panel */}
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
        {/* Mobile & Tablet Fixed Top Bar: compact app logo left, space, bare Bell + 3-dot menu right; turns solid dark ash smoothly on scroll */}
        <header
          className={`lg:hidden fixed top-0 inset-x-0 z-40 h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] px-4 sm:px-6 flex items-center justify-between transition-colors duration-250 ease-out ${
            isScrolled
              ? 'bg-[#1D1E23] text-white shadow-[0_6px_18px_-6px_rgba(14,15,20,0.42)]'
              : activeScreen === 'home'
              ? 'bg-transparent text-white'
              : 'bg-[#F6F7F9] text-[#1D1E23] border-b border-[#1A1B20]/[0.06]'
          }`}
        >
          <button
            type="button"
            onClick={() => onNavigate('home')}
            aria-label="pqguide home"
            className="min-h-[40px] min-w-[40px] flex items-center justify-start cursor-pointer transition-transform duration-150 active:scale-95"
          >
            <BrandLogo className="w-9" />
          </button>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onNavigate('notifications')}
              aria-label={`Open notifications (${unreadCount} unread)`}
              className={`relative h-10 w-10 rounded-full flex items-center justify-center cursor-pointer transition-opacity duration-150 active:opacity-70 ${
                activeScreen === 'home' || isScrolled
                  ? 'text-white'
                  : 'text-[#1D1E23]'
              }`}
            >
              <span className="relative inline-flex items-center justify-center">
                <Bell className="w-[21px] h-[21px]" strokeWidth={2} />
                {unreadCount > 0 && (
                  <span
                    className={`absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold font-mono-tabular flex items-center justify-center ${
                      activeScreen === 'home' || isScrolled
                        ? 'bg-white text-[#1D1E23]'
                        : 'bg-[#1D1E23] text-white'
                    }`}
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </span>
            </button>

            <button
              type="button"
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
              aria-controls="mobile-slide-drawer"
              onClick={() => setDrawerOpen(true)}
              className={`h-10 w-10 -mr-1.5 rounded-full flex items-center justify-center cursor-pointer transition-opacity duration-150 active:opacity-70 ${
                activeScreen === 'home' || isScrolled
                  ? 'text-white'
                  : 'text-[#1D1E23]'
              }`}
            >
              <MoreVertical className="w-[21px] h-[21px]" strokeWidth={2} />
            </button>
          </div>
        </header>

        {/* Desktop 3-Zone Top Bar */}
        <header
          className={`hidden lg:flex items-center justify-between gap-8 px-8 py-4 bg-white border-b border-[#1A1B20]/[0.06] sticky top-0 z-30`}
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
            <button
              type="button"
              onClick={() => onNavigate('notifications')}
              aria-label={`Open notifications (${unreadCount} unread)`}
              className={`relative min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center border transition-transform duration-150 active:scale-95 cursor-pointer ${
                activeScreen === 'notifications'
                  ? 'tactile-dark text-white border-transparent'
                  : onBanner
                    ? 'bg-white/10 hover:bg-white/20 text-white border-white/20'
                    : 'bg-[#F6F7F9] hover:bg-[#ECEEF3] text-[#1D1E23] border-[#1A1B20]/[0.08]'
              }`}
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span
                  className={`absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold font-mono-tabular flex items-center justify-center ${
                    activeScreen === 'notifications'
                      ? 'bg-white text-[#1D1E23]'
                      : 'bg-[#1D1E23] text-white'
                  }`}
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            <button
              ref={desktopTriggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              aria-label="Open student account menu"
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
          </div>
        </header>

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
                  {student.matricNumber}
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

        {/* Mobile & Tablet Slide-Out Navigation Drawer (slides from right beside hamburger) */}
        <div
          aria-hidden={!drawerOpen}
          className={`lg:hidden fixed inset-0 z-50 flex justify-end transition-opacity duration-200 ${
            drawerOpen
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Dimmed Scrim */}
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

          {/* Sliding Panel */}
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
                    onNavigate('home');
                    setDrawerOpen(false);
                  }}
                  className="flex flex-col items-start gap-1.5 text-left cursor-pointer min-w-0"
                >
                  <BrandLockup className="h-8 w-auto text-[#1A1B20]" />
                  <span className="block text-xs text-[#686C78] truncate">
                    University Exam Archive
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close navigation menu"
                  className="min-h-[44px] min-w-[44px] rounded-2xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-[#1A1B20] flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Student Account Card */}
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
                      {student.matricNumber}
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

              {/* Primary Navigation Links */}
              <nav aria-label="Mobile drawer navigation" className="space-y-1">
                {navItems.map((item) => {
                  const isActive =
                    tabScreen === item.id;
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

              {/* Company links (kept in the side panel on mobile and tablet) */}
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
            </div>

            {/* Bottom Controls: Workspace Switcher & Sign Out */}
            <div className="p-5 pt-4 border-t border-[#1A1B20]/[0.07] space-y-3">
              <CustomSelect
                id="mobile-role-select"
                label="Active Workspace View"
                size="sm"
                menuPlacement="top"
                value={activeRole}
                options={[
                  { value: 'student', label: 'Student View' },
                  { value: 'school_admin', label: 'School Admin View' },
                  { value: 'super_admin', label: 'Super Admin View' },
                ]}
                onChange={(val) => {
                  const role = val as UserRole;
                  onRoleChange(role);
                  if (role === 'school_admin') onNavigate('school_admin');
                  else if (role === 'super_admin') onNavigate('super_admin');
                  else onNavigate('home');
                  setDrawerOpen(false);
                }}
              />

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
          className={`flex-1 w-full mx-auto pb-24 ${
            activeScreen === 'home'
              ? 'max-w-6xl px-4 sm:px-6 lg:px-8 pt-0 lg:pt-8 lg:pb-8'
              : 'max-w-6xl px-4 sm:px-6 lg:px-8 pt-[calc(68px+env(safe-area-inset-top))] lg:pt-8 lg:pb-8'
          }`}
        >
          {children}
        </main>
      </div>

      {/* Mobile Bottom Tab Footer (<= 15% mobile height) */}
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

          {/* Raised Center Tactile Dark Ash Quick Action Button */}
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
            onClick={() =>
              onNavigate(activeScreen === 'school_admin' ? 'super_admin' : 'school_admin')
            }
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
              activeScreen === 'school_admin' || activeScreen === 'super_admin'
                ? 'text-white font-semibold'
                : 'text-[#9CA0AE]'
            }`}
          >
            {activeScreen === 'super_admin' ? (
              <ShieldCheck className="w-5 h-5" />
            ) : (
              <UploadCloud className="w-5 h-5" />
            )}
            <span className="text-[10px] leading-none">
              {activeScreen === 'super_admin' ? 'Control' : 'Admin'}
            </span>
          </button>
        </div>
      </nav>
    </div>
  );
};
