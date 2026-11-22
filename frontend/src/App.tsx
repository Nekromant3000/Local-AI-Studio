import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import ChatHeader from "./components/ChatHeader";
import ChatWorkspace from "./components/ChatWorkspace";
import Composer from "./components/Composer";
import RightPanel from "./components/RightPanel";
import Sidebar from "./components/Sidebar";
import { useMediaQuery } from "./lib/useMediaQuery";
import { useAppStore } from "./store/useAppStore";

function Toasts() {
  const error = useAppStore((state) => state.error);
  const notice = useAppStore((state) => state.notice);
  const setError = useAppStore((state) => state.setError);
  const setNotice = useAppStore((state) => state.setNotice);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 12000);
    return () => clearTimeout(timer);
  }, [error, setError]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  if (!error && !notice) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
      {error ? (
        <div className="toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border border-rose-400/30 bg-[#1a0d16]/95 px-3.5 py-3 shadow-2xl backdrop-blur">
          <AlertTriangle size={16} className="mt-0.5 flex-none text-rose-300" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-rose-100">Ошибка</div>
            <div className="mt-0.5 break-words text-[11px] leading-relaxed text-rose-200/85">
              {error}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn h-6 w-6 flex-none text-rose-300/70 hover:!text-rose-100"
            onClick={() => setError(null)}
            title="Закрыть"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border border-emerald-300/25 bg-[#0b1a17]/95 px-3.5 py-3 shadow-2xl backdrop-blur">
          <CheckCircle2 size={16} className="mt-0.5 flex-none text-emerald-300" />
          <div className="min-w-0 flex-1 text-[11px] leading-relaxed text-emerald-100/90">
            {notice}
          </div>
          <button
            type="button"
            className="icon-btn h-6 w-6 flex-none text-emerald-300/70 hover:!text-emerald-100"
            onClick={() => setNotice(null)}
            title="Закрыть"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Splash() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-ink-400">
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-accent-500/30 blur-xl" />
          <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-accent-300/25 bg-gradient-to-br from-[#26336b] to-[#10182f]">
            <Loader2 size={22} className="spin text-accent-300" />
          </div>
        </div>
        <div className="text-[12px]">Сканирую папку Google AI Studio…</div>
      </div>
    </div>
  );
}

export default function App() {
  const bootstrap = useAppStore((state) => state.bootstrap);
  const doc = useAppStore((state) => state.doc);
  const chats = useAppStore((state) => state.chats);
  const loadingChats = useAppStore((state) => state.loadingChats);
  const loadingDoc = useAppStore((state) => state.loadingDoc);
  const chatDir = useAppStore((state) => state.chatDir);

  const isDesktop = useMediaQuery("(min-width: 1280px)");
  const [desktopSidebar, setDesktopSidebar] = useState(true);
  const [desktopRight, setDesktopRight] = useState(true);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [mobileRight, setMobileRight] = useState(false);
  const sidebarShellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const shell = sidebarShellRef.current;
    if (!shell) return;
    if (!isDesktop || desktopSidebar) {
      shell.removeAttribute("inert");
      return;
    }
    if (shell.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur();
    }
    shell.setAttribute("inert", "");
  }, [isDesktop, desktopSidebar]);

  useEffect(() => {
    document.title = doc ? `${doc.title} · Local AI Studio` : "Local AI Studio";
  }, [doc?.title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileSidebar(false);
        setMobileRight(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        if (window.innerWidth >= 1280) setDesktopSidebar((value) => !value);
        else setMobileSidebar((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const sidebarOpen = isDesktop ? desktopSidebar : mobileSidebar;
  const rightOpen = isDesktop ? desktopRight : mobileRight;

  const toggleSidebar = () => {
    if (isDesktop) setDesktopSidebar((value) => !value);
    else setMobileSidebar((value) => !value);
  };

  const toggleRight = () => {
    if (isDesktop) setDesktopRight((value) => !value);
    else setMobileRight((value) => !value);
  };

  const initialLoading = loadingChats && !chats.length && !doc && !loadingDoc;

  return (
    <div className="app-bg flex h-screen w-screen overflow-hidden bg-[#070b14] text-ink-100">
      {isDesktop ? (
        <div
          ref={sidebarShellRef}
          className={`h-full flex-none overflow-hidden transition-[width] duration-200 ease-out ${
            sidebarOpen ? "w-[302px]" : "w-0"
          }`}
        >
          <Sidebar onClose={() => setDesktopSidebar(false)} />
        </div>
      ) : null}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <ChatHeader
          onToggleSidebar={toggleSidebar}
          onToggleRight={toggleRight}
          rightOpen={rightOpen}
          sidebarOpen={sidebarOpen}
        />

        {initialLoading ? (
          <Splash />
        ) : (
          <>
            <ChatWorkspace />
            {doc ? <Composer onOpenSettings={() => (isDesktop ? setDesktopRight(true) : setMobileRight(true))} /> : null}
            {!doc && !loadingDoc ? (
              <div className="flex-none border-t border-white/[0.06] px-4 py-3 text-center text-[10.5px] text-ink-500">
                {chats.length
                  ? "Выберите чат в левой панели, чтобы начать работу."
                  : `В папке ${chatDir || "Google AI Studio"} пока нет чатов. Создайте новый чат в левой панели.`}
              </div>
            ) : null}
          </>
        )}
      </main>

      {isDesktop && rightOpen ? (
        <RightPanel onClose={() => setDesktopRight(false)} />
      ) : null}

      {!isDesktop && mobileSidebar ? (
        <div className="fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileSidebar(false)}
          />
          <div className="panel-slide-left relative h-full w-[310px] max-w-[88vw] shadow-2xl">
            <Sidebar overlay onClose={() => setMobileSidebar(false)} />
          </div>
        </div>
      ) : null}

      {!isDesktop && mobileRight ? (
        <div className="fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileRight(false)}
          />
          <div className="panel-slide-right absolute right-0 top-0 h-full w-[360px] max-w-[92vw] shadow-2xl">
            <RightPanel overlay onClose={() => setMobileRight(false)} />
          </div>
        </div>
      ) : null}

      <Toasts />
    </div>
  );
}
