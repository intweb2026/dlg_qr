import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import EventMobileMenu from "./EventMobileMenu";
import RegisteredDelegatesMobile from "./RegisteredDelegatesMobile";
import AskAQuestionMobile from "./AskAQuestionMobile";
import ThankYouMobile from "./ThankYouMobile";
import WifiPasswordMobile from "./WifiPasswordMobile";
function App() {
  return (
    <Routes>
      <Route path="/" element={<EventMobileMenu />} />
      <Route path="/registered-attendees" element={<RegisteredDelegatesMobile />} />
      <Route path="/ask-a-question" element={<AskAQuestionMobile />} />
      <Route path="/thank-you" element={<ThankYouMobile />} />
      <Route path="/wifipassword" element={<WifiPasswordMobile />} />
    </Routes>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);