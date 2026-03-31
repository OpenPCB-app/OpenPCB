import type { LogEntry } from "@shared/types/logger";

export interface FeedbackData {
  email?: string;
  type: "idea" | "bug" | "critique" | "other";
  message: string;
  images: File[];
  timestamp: string;
  appVersion: string;
  userAgent: string;
  frontendLogs?: string;
  backendLogs?: string;
  systemContext?: SystemContext;
}

export interface SystemContext {
  activeWorkspaceId?: string;
  activeProjectId?: string;
  currentScreen?: string;
  windowSize: { width: number; height: number };
  screenResolution: { width: number; height: number };
  language: string;
  platform: string;
  onlineStatus: boolean;
}

export interface FeedbackResponse {
  success: boolean;
  id?: string;
  message?: string;
}

export interface BackendLogsResponse {
  logs: LogEntry[];
  count: number;
  timeRange: {
    from: string;
    to: string;
  };
}

const FEEDBACK_API_URL = import.meta.env.VITE_FEEDBACK_API_URL || "http://localhost:3000/v1/feedback";
const FEEDBACK_API_KEY = import.meta.env.VITE_FEEDBACK_API_KEY || "";

export const APP_VERSION = "0.1.0";

export async function fetchBackendLogs(
  backendURL: string,
  minutes: number = 5
): Promise<BackendLogsResponse> {
  const logsEndpoint = `${backendURL}/api/logs?minutes=${minutes}&count=500`;

  try {
    const response = await fetch(logsEndpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(
        `[Feedback] Failed to fetch backend logs: HTTP ${response.status} - ${errorText}`
      );
      return {
        logs: [],
        count: 0,
        timeRange: { from: new Date().toISOString(), to: new Date().toISOString() },
      };
    }

    const data = await response.json();

    if (!data || typeof data !== "object") {
      console.error("[Feedback] Invalid logs response format:", data);
      return {
        logs: [],
        count: 0,
        timeRange: { from: new Date().toISOString(), to: new Date().toISOString() },
      };
    }

    if (!Array.isArray(data.logs)) {
      console.error("[Feedback] Logs field is not an array:", data);
      return {
        logs: [],
        count: data.count || 0,
        timeRange: data.timeRange || { from: new Date().toISOString(), to: new Date().toISOString() },
      };
    }

    return data;
  } catch (error) {
    console.error("[Feedback] Error fetching backend logs from", logsEndpoint, ":", error);
    return {
      logs: [],
      count: 0,
      timeRange: { from: new Date().toISOString(), to: new Date().toISOString() },
    };
  }
}

export function getSystemContext(): SystemContext {
  const platform = detectPlatform();

  return {
    windowSize: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    screenResolution: {
      width: window.screen.width,
      height: window.screen.height,
    },
    language: navigator.language,
    platform,
    onlineStatus: navigator.onLine,
  };
}

function detectPlatform(): string {
  const userAgent = navigator.userAgent;

  if (userAgent.includes("Mac")) {
    if (userAgent.includes("arm64") || userAgent.includes("ARM64")) {
      return "macOS (Apple Silicon)";
    }

    return "macOS (Intel)";
  }

  if (userAgent.includes("Win")) {
    return "Windows";
  }

  if (userAgent.includes("Linux")) {
    return "Linux";
  }

  return navigator.platform;
}

export async function submitFeedback(
  data: FeedbackData
): Promise<FeedbackResponse> {
  const formData = new FormData();

  if (data.email) {
    formData.append("email", data.email);
  }
  formData.append("type", data.type);
  formData.append("message", data.message);
  formData.append("timestamp", data.timestamp);
  formData.append("appVersion", data.appVersion);
  formData.append("userAgent", data.userAgent);

  if (data.systemContext) {
    formData.append("systemContext", JSON.stringify(data.systemContext));
  }

  data.images.forEach((image, index) => {
    formData.append(`image_${index}`, image);
  });

  if (data.frontendLogs) {
    formData.append(
      "frontend_logs",
      new Blob([data.frontendLogs], { type: "text/plain" }),
      "frontend-logs.txt"
    );
  }

  if (data.backendLogs) {
    formData.append(
      "backend_logs",
      new Blob([data.backendLogs], { type: "text/plain" }),
      "backend-logs.txt"
    );
  }

  const headers: Record<string, string> = {};
  if (FEEDBACK_API_KEY) {
    headers["X-API-Key"] = FEEDBACK_API_KEY;
  }

  const response = await fetch(FEEDBACK_API_URL, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.message || `HTTP error! status: ${response.status}`
    );
  }

  return await response.json();
}
