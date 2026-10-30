import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./RegisteredDelegatesMobile.css";
import { useEvent, useEventPath } from "./event/EventContext";
import api from "./feedback/api";

const backButtonBlack = "/images/common/back_button_black.png";
const backButtonBlue = "/images/common/back_button_blue.png";

// The list comes live from the event's attendees table, walk-ins added on the feedback form are left out.
export default function RegisteredDelegatesMobile() {
  const navigate = useNavigate();
  const { config } = useEvent();
  const eventPath = useEventPath();
  const [delegates, setDelegates] = useState(null);
  const [failed, setFailed] = useState(false);



  useEffect(() => {
    api
      .get("/registered-attendees/")
      .then(({ data }) => setDelegates(data))
      .catch(() => setFailed(true));
  }, []);

  console.log('delegates', delegates);
  let message = null;
  if (failed) message = "The attendee list will be published soon.";
  // else if (!delegates) message = "Loading attendees...";
  // else if (!delegates.length) message = "No attendees registered yet.";

  return (
    // <div
    //   className="delegates-mobile"
    //   style={{

    //     "--delegates-bg": `url(${config.media?.background})`,
    //   }}
    // >

    //   <div className="delegates-mobile__card">
    //     <div className="delegates-mobile__title_button">
    //       <button
    //         type="button"
    //         className="delegates-mobile__back_button"
    //         aria-label="Go back"
    //         onClick={() => navigate(eventPath())}
    //       >
    //         <img
    //           src={backButtonBlack}
    //           alt=""
    //           className="delegates-mobile__back_button-icon delegates-mobile__back_button-icon--normal"
    //         />
    //         <img
    //           src={backButtonBlue}
    //           alt=""
    //           className="delegates-mobile__back_button-icon delegates-mobile__back_button-icon--hover"
    //         />
    //       </button>
    //       <h1 className="delegates-mobile__title">Registered Attendees</h1>
    //     </div>

    //     <div className="delegates-mobile__table-wrap">
    //       <table className="delegates-mobile__table">
    //         <thead>
    //           <tr>
    //             <th>Company Name</th>
    //             <th>Delegate Name</th>
    //           </tr>
    //         </thead>
    //         <tbody>
    //           {message && (
    //             <tr>
    //               <td colSpan={2}>{message}</td>
    //             </tr>
    //           )}
    //           {(delegates || []).map((row, index) => (
    //             <tr key={`${row.company}-${row.name}-${index}`}>
    //               <td>{row.company}</td>
    //               <td>{row.name}</td>
    //             </tr>
    //           ))}
    //         </tbody>
    //       </table>
    //     </div>
    //   </div>
    // </div>
    <div className="page">
      <div className="card">
        <div className="title-container">
          <a className="back_btn" href={eventPath()}>
            <img src={backButtonBlue} alt="" />
          </a>
          <h1 className="title">Registered Attendees</h1>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Delegate Name</th>
                <th>Company Name</th>
              </tr>
            </thead>
            <tbody>
              {message && (
                <tr>
                  <td colSpan={2}>{message}</td>
                </tr>
              )}
              {(delegates || []).map((row, index) => (
                <tr key={`${row.company}-${row.name}-${index}`}>
                  <td>{row.name}</td>
                  <td>{row.company}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          This attendee list was last updated on 21th August 2026. Registrations received after this date are not included. The latest list will be available online and will include all registered participants.
        </p>
      </div>
    </div>
  );
}