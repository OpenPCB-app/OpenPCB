import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";

interface SidebarButtonsState {
  rightTop: ReactNode[];
  rightBottom: ReactNode[];
}

interface SidebarButtonsContextValue extends SidebarButtonsState {
  setRightTopButtons: (buttons: ReactNode[]) => void;
  setRightBottomButtons: (buttons: ReactNode[]) => void;
  clearButtons: () => void;
}

const SidebarButtonsContext = createContext<SidebarButtonsContextValue | null>(
  null,
);

export function SidebarButtonsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SidebarButtonsState>({
    rightTop: [],
    rightBottom: [],
  });

  const setRightTopButtons = useCallback((buttons: ReactNode[]) => {
    setState((prev) => ({ ...prev, rightTop: buttons }));
  }, []);

  const setRightBottomButtons = useCallback((buttons: ReactNode[]) => {
    setState((prev) => ({ ...prev, rightBottom: buttons }));
  }, []);

  const clearButtons = useCallback(() => {
    setState({ rightTop: [], rightBottom: [] });
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      setRightTopButtons,
      setRightBottomButtons,
      clearButtons,
    }),
    [state, setRightTopButtons, setRightBottomButtons, clearButtons],
  );

  return (
    <SidebarButtonsContext.Provider value={value}>
      {children}
    </SidebarButtonsContext.Provider>
  );
}

export function useSidebarButtons() {
  const context = useContext(SidebarButtonsContext);
  if (!context) {
    throw new Error(
      "useSidebarButtons must be used within SidebarButtonsProvider",
    );
  }
  return context;
}

export function useRegisterSidebarButtons() {
  const { setRightTopButtons, setRightBottomButtons, clearButtons } =
    useSidebarButtons();
  return { setRightTopButtons, setRightBottomButtons, clearButtons };
}
