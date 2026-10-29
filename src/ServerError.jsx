import React, { useEffect } from "react";

// Shown on the bare home page /, which has no event. Every real page starts with an event code, /dle26.
export default function ServerError() {
  useEffect(() => {
    document.title = "500 Internal Server Error";
  }, []);

  return (
    <main className="server-error">
      <h1 className="server-error__title">500 Internal Server Error</h1>
      <hr className="server-error__rule" />
      <p className="server-error__text">The server encountered an internal error and was unable to complete your request.</p>
    </main>
  );
}
