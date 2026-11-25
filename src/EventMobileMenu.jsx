import React from "react";
// eslint-disable-next-line no-unused-vars -- used by the commented-out menu below
import { Link } from "react-router-dom";
import "./EventMobileMenu.css";
import { useEvent, useEventPath } from "./event/EventContext";

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

export default function EventMobileMenu() {
  const { config } = useEvent();
  const eventPath = useEventPath();
  const media = config.media || {};
  const menu = config.menu || [];

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
    </div>
  );
}
