import React from "react";
import { Link } from "react-router-dom";
import "./EventMobileMenu.css";
import { useEvent, useEventPath } from "./event/EventContext";

const forwardIcon = "/images/common/forward_icon.png";

// The same menu for every event. Items with "link" open that address from the event file's "links",
// items with "to" open a page of the event.
const MENU_ITEMS = [
  {
    label: "Explore the Agenda", icon: "/images/common/Agenda_icon.png", link: "agenda", svg: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2-2V3a2 2 0 0 0-2 2m0 0a2 2 0 0 1 2-2v0a2 2 0 0 1 2 2m0 0V7a2 2 0 0 0-2-2m0 0h4">
      </path>
      <line x1="9" y1="13" x2="15" y2="13"></line>
      <line x1="9" y1="17" x2="15" y2="17"></line>
    </svg>
  },
  {
    label: "Registered Attendees", icon: "/images/common/Registration%20icon.png", to: "/registered-attendees", svg: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>
  },
  {
    label: "Feedback Form", icon: "/images/common/Feedback_icon.png", to: "/feedback-form", svg: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="19" viewBox="0 0 20 19" fill="none">
      <path d="M7.5 17.2A9.5 8.5 0 1 0 2.8 14.55L1.3 18.2Z"
        stroke="#fff" stroke-width="1" stroke-linejoin="round" />
      <circle cx="6" cy="9.5" r="1" fill="#fff" />
      <circle cx="10" cy="9.5" r="1" fill="#fff" />
      <circle cx="14" cy="9.5" r="1" fill="#fff" />
    </svg>
  },
  {
    label: "Wi-Fi Password", icon: "/images/common/wifiicon.png", to: "/wifipassword", svg: <svg class="wifi-mobile__icon" viewBox="0 0 24 18" aria-hidden="true" width="20" height="20" fill="none" stroke="white">
      <path d="M12 3.5c4.14 0 7.9 1.63 10.66 4.28a1 1 0 0 1 .02 1.42l-1.4 1.4a1 1 0 0 1-1.38.03A13.6 13.6 0 0 0 12 7.3a13.6 13.6 0 0 0-7.9 3.33 1 1 0 0 1-1.38-.03l-1.4-1.4a1 1 0 0 1 .02-1.42C4.1 5.13 7.86 3.5 12 3.5Z" fill="currentColor"></path>
      <path d="M12 9.3c2.36 0 4.53.83 6.24 2.22a1 1 0 0 1 .07 1.47l-1.42 1.42a1 1 0 0 1-1.32.08A6.1 6.1 0 0 0 12 13.1a6.1 6.1 0 0 0-3.57 1.39 1 1 0 0 1-1.32-.08l-1.42-1.42a1 1 0 0 1 .07-1.47A9.9 9.9 0 0 1 12 9.3Z" fill="currentColor"></path>
      <circle cx="12" cy="16.3" r="1.7" fill="currentColor"></circle>
    </svg>
  },
  {
    label: "Connect on LinkedIn", icon: "/images/common/Linkedin.png", link: "linkedin", svg: <svg viewBox="0 0 24 24" width="20" height="20" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"></path>
    </svg>
  },
  {
    label: "Visit the Event Website", icon: "/images/common/Web.png", link: "website", svg: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z">
      </path>
      <path d="M2 12h20"></path>
    </svg>
  },
];

export default function EventMobileMenu() {
  const { config } = useEvent();
  const eventPath = useEventPath();
  const media = config.media || {};

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
    //         {MENU_ITEMS.map((item) => {
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
          {MENU_ITEMS.map((item) => {
            const href = item.link ? config.links?.[item.link] : eventPath(item.to);
            return (
              <a
                className="action-button"
                key={item.label}
                href={href}
              >
                <span className="icon">
                  {item.svg}
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
