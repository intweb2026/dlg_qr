import React, { useEffect, useState } from "react";
// eslint-disable-next-line no-unused-vars -- used by the commented-out menu below
import { Link } from "react-router-dom";
import "./EventMobileMenu.css";
import { useEvent, useEventPath } from "./event/EventContext";
import api from "./feedback/api";

// eslint-disable-next-line no-unused-vars -- used by the commented-out menu below
const forwardIcon = "/images/common/forward_icon.png";

// The menu comes from the event config, set on the admin Event Details page. An item's target is a page of the
// event (/feedback-form), "website" for the event's website link, or a full URL.
const LINK_KEYS = ["website"];

/** Where a menu item goes, or null when it points at an event link that is not set. */
function menuHref(item, config, eventPath) {
  const target = item.target || "";
  if (target.startsWith("/")) return eventPath(target);
  if (LINK_KEYS.includes(target)) return config.links?.[target] || null;
  return target || null;
}

// Keyed by the form status the admin sets on the Submissions page, an unknown status uses inactive.
const FEEDBACK_POPUPS = {
  inactive: { title: "Form Not Enabled By Admin", message: "Feedback is not available at the moment." },
  upcoming: { title: "Event Not Started", message: "Feedback is not open yet." },
  ended: { title: "Event Ended", message: "This event has ended, so feedback is no longer open." }
};

// Returns the popup to show, or null when the form can open. If the status cannot be loaded, the form page shows its own message.
async function feedbackPopup() {
  try {
    const { data } = await api.get("/form-status/");
    if (data.is_active) return null;
    return FEEDBACK_POPUPS[data.form_status] || FEEDBACK_POPUPS.inactive;
  } catch (err) {
    return null;
  }
}

function MenuPopup({ popup, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="menu-popup" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="menu-popup__box" role="dialog" aria-modal="true" aria-labelledby="menu-popup-title">
        <h2 className="menu-popup__title" id="menu-popup-title">{popup.title}</h2>
        <p className="menu-popup__message">{popup.message}</p>
        <button type="button" className="menu-popup__button" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </div>
  );
}

export default function EventMobileMenu() {
  const { config } = useEvent();
  const eventPath = useEventPath();
  const media = config.media || {};
  const menu = config.menu || [];
  const [popup, setPopup] = useState(null);
  const [checking, setChecking] = useState(false);

  const openFeedback = async (e, href) => {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    const blocked = await feedbackPopup();
    setChecking(false);
    if (blocked) setPopup(blocked);
    else window.location.assign(href);
  };

  return (
    // <div className="wls-menu">
    //   <video
    //     className="wls-menu__video"
    //     src={media.heroVideo}
    //     poster={media.heroPoster}
    //     autoPlay
    //     loop
    //     muted
    //     playsInline
    //   />

    //   <div className="wls-menu__overlay" aria-hidden="true" />

    //   <div className="wls-menu__content">

    //     <div className="wls-menu__card">
    //       <img src={media.logo} alt={config.name} className="wls-menu__title" />

    //       {config.tagline && <p className="wls-menu__subtitle">{config.tagline}</p>}

    //       <div className="wls-menu__list">
    //         {menu.map((item) => {
    //           const href = item.link ? config.links?.[item.link] : null;
    //           const content = (
    //             <>
    //               <span className="wls-menu__icon">
    //                 <img src={item.icon} alt="" />
    //               </span>
    //               <span className="wls-menu__divider" aria-hidden="true" />
    //               <span className="wls-menu__label">{item.label}</span>
    //               <img src={forwardIcon} alt="" className="wls-menu__arrow" />
    //             </>
    //           );
    //           return (
    //             <div key={item.label} className="wls-menu__item">
    //               {item.to ? (
    //                 <Link to={eventPath(item.to)} className="wls-menu__link">
    //                   {content}
    //                 </Link>
    //               ) : (
    //                 <a
    //                   href={href}
    //                   className="wls-menu__link"
    //                   {...(href?.startsWith("http")
    //                     ? { target: "_blank", rel: "noopener noreferrer" }
    //                     : {})}
    //                 >
    //                   {content}
    //                 </a>
    //               )}
    //             </div>
    //           );
    //         })}
    //       </div>
    //     </div>
    //   </div>
    // </div>
    <div className="container">
      <video className="background-video" autoPlay
        muted
        loop
        playsInline
        preload="none"
        poster={media.heroPoster}>
        <source
          src={media.heroVideoWebm}
          type="video/webm"
        />
        <source
          src={media.heroVideoMp4}
          type="video/mp4"
        />
      </video>
      <div className="gradient-overlay"></div>
      <div className="card">
        <div className="header">
          <div className="logo">
            <img src={media.logo} alt="Event Logo" />
          </div>
          <p className="subtitle">
            {config.tagline}
          </p>
        </div>
        <div className="button-group">
          {menu.map((item) => {
            const href = menuHref(item, config, eventPath);
            if (!href) return null;
            return (
              <a
                className="action-button"
                key={item.id}
                href={href}
                {...(item.target === "/feedback-form" ? { onClick: (e) => openFeedback(e, href) } : {})}
              >
                <span className="icon">
                  {item.icon && <img src={item.icon} alt="" />}
                </span>
                <span className="divider"></span>
                <span className="label">{item.label}</span>
                <svg class="arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </a>
            );
          })}
        </div>
      </div>
      {popup && <MenuPopup popup={popup} onClose={() => setPopup(null)} />}
    </div>
  );
}
