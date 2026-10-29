import React from "react";
import { Link } from "react-router-dom";
import "./EventMobileMenu.css";
import { useEvent, useEventPath } from "./event/EventContext";

const forwardIcon = "/images/common/forward_icon.png";

// The same menu for every event. Items with "link" open that address from the event file's "links",
// items with "to" open a page of the event.
const MENU_ITEMS = [
  { label: "Explore the Agenda", icon: "/images/common/Agenda_icon.png", link: "agenda" },
  { label: "Registered Attendees", icon: "/images/common/Registration%20icon.png", to: "/registered-attendees" },
  { label: "Feedback Form", icon: "/images/common/Feedback_icon.png", to: "/feedback-form" },
  { label: "Wi-Fi Password", icon: "/images/common/wifiicon.png", to: "/wifipassword" },
  { label: "Connect on LinkedIn", icon: "/images/common/Linkedin.png", link: "linkedin" },
  { label: "Visit the Event Website", icon: "/images/common/Web.png", link: "website" },
];

export default function EventMobileMenu() {
  const { config } = useEvent();
  const eventPath = useEventPath();
  const media = config.media || {};

  return (
    <div className="wls-menu">
      <video
        className="wls-menu__video"
        src={media.heroVideo}
        poster={media.heroPoster}
        autoPlay
        loop
        muted
        playsInline
      />

      <div className="wls-menu__overlay" aria-hidden="true" />

      <div className="wls-menu__content">

        <div className="wls-menu__card">
          <img src={media.logo} alt={config.name} className="wls-menu__title" />

          {config.tagline && <p className="wls-menu__subtitle">{config.tagline}</p>}

          <div className="wls-menu__list">
            {MENU_ITEMS.map((item) => {
              const href = item.link ? config.links?.[item.link] : null;
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
                    <Link to={eventPath(item.to)} className="wls-menu__link">
                      {content}
                    </Link>
                  ) : (
                    <a
                      href={href}
                      className="wls-menu__link"
                      {...(href?.startsWith("http")
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
