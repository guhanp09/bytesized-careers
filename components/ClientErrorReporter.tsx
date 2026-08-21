"use client";

import { useEffect } from "react";

import { reportClientError } from "../lib/clientErrorReporter";

export default function ClientErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportClientError(event.error, "window");
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportClientError(event.reason, "unhandled_rejection");
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
