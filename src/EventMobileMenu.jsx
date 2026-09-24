import React from "react";
import { Link } from "react-router-dom";
import "./EventMobileMenu.css";
import { heroVideoSrc, heroPoster } from "./mediaassets";

const titleLockup = "/images/DLE_Logo.png";
const forwardIcon = "/images/forward_icon.png";

const iconAgenda = "/images/Agenda_icon.png";
const iconDelegates = "/images/Registration%20icon.png";
const iconGlobe = "/images/Web.png";
const iconLinkedin = "/images/Linkedin.png";
// const iconQuestion = "/images/Question.png";
const iconWifi = "/images/wifiicon.png";



const MENU_ITEMS = [
  { label: "Explore the Agenda", icon: iconAgenda, href: process.env.REACT_APP_AGENDA_URL },
  { label: "Registered Attendees", icon: iconDelegates, to: "/registered-attendees" },
  { label: "Connect on LinkedIn ", icon: iconLinkedin, href: process.env.REACT_APP_LINKEDIN_URL },
  { label: "Wi-Fi Password", icon: iconWifi, to: "/wifipassword" },
  { label: "Visit the Event Website", icon: iconGlobe, href: process.env.REACT_APP_EVENT_WEBSITE_URL },
  // { label: "Ask A Question", icon: iconQuestion, to: "/ask-a-question" },
];

export default function EventMobileMenu() {
  return (
    <div className="wls-menu">
      <video
        className="wls-menu__video"
        src={heroVideoSrc}
        poster={heroPoster}
        autoPlay
        loop
        muted
        playsInline
      />

      <div className="wls-menu__overlay" aria-hidden="true" />

      <div className="wls-menu__content">

        <div className="wls-menu__card">
          <img src={titleLockup} alt="Water Leakage Summit 2026" className="wls-menu__title" />

          <p className="wls-menu__subtitle">
            {"THE PREMIER FORUM FOR SUSTAINABLE\nLITHIUM PRODUCTION IN EUROPE"}
          </p>

          <div className="wls-menu__list">
            {MENU_ITEMS.map((item) => {
              const content = (
                <>
                  <span className="wls-menu__icon">
                    <img src={item.icon} alt="" />
                  </span>
                  <span className="wls-menu__divider" aria-hidden="true" />
                  <span className="wls-menu__label">{item.label}</span>
                  <img src={forwardIcon} alt="" className="wls-menu__arrow" />
                </>
              );
              return (
                <div key={item.label} className="wls-menu__item">
                  {item.to ? (
                    <Link to={item.to} className="wls-menu__link">
                      {content}
                    </Link>
                  ) : (
                    <a
                      href={item.href}
                      className="wls-menu__link"
                      {...(item.href?.startsWith("http")
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                    >
                      {content}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}