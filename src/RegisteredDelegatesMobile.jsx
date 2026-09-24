import React from "react";
import { useNavigate } from "react-router-dom";
import "./RegisteredDelegatesMobile.css";
import { backButtonBlack, backButtonBlue } from "./mediaassets";

const DEFAULT_DELEGATES = [
  { delegate: "Alexander Koester", company: "EPC Engineering & Technologies GmbH" },
  { delegate: "Alexandre Constant", company: "Saint-Gobain Coating Solutions" },
  { delegate: "Anca Savalache", company: "Avocet Battery Materials" },
  { delegate: "Andreas Kuhlmann", company: "Forschungszentrum Jülich GmbH" },
  { delegate: "Andrew Walker", company: "Evove Ltd" },
  { delegate: "Antoinette Manyaga", company: "US embassy Cameroon" },
  { delegate: "Anton Dr. Kaiser", company: "TIB Chemicals AG" },
  { delegate: "Anya Oppenheimer", company: "Syngenta" },
  { delegate: "Christian Heubner", company: "Fraunhofer IKTS" },
  { delegate: "Christoph Maurer", company: "OSMO Membrane Systems" },
  { delegate: "Daniel Espinoza", company: "Lithium Ark" },
  { delegate: "Dominic Wells", company: "Project Blue" },
  { delegate: "Dr. Liviu Mantescu", company: "Watergenics GmbH" },
  { delegate: "Emmanuel Markun", company: "ArcelorMittal" },
  { delegate: "Frank Jackel", company: "Metals hub" },
  { delegate: "Frederic Nicolle", company: "Future Pipe Industries B.V." },
  { delegate: "Hans van 't Spijker", company: "Witteveen+Bos Raadgevende ingenieurs B.V." },
  { delegate: "Hao Zeng", company: "Zhejiang ENCO Machinery Co.ltd" },
  { delegate: "Hartmut Rapp", company: "TIB Chemicals AG" },
  { delegate: "Hasan Coskun", company: "Koyuncu Nakliye Pazarlama ve Tic. A.S." },
  { delegate: "Irina Melkonyan", company: "Wood Mackenzie" },
  { delegate: "Jaco BESTER", company: "Specialty Electronic Materials Netherlands B.v." },
  { delegate: "James Patterson", company: "ETH Zurich" },
  { delegate: "James W. Patterson", company: "ETH Zurich" },
  { delegate: "Joanne Ye", company: "Zhejiang Dongou Filter Manufacturing Co., Ltd" },
  { delegate: "Jon López Díaz", company: "EagleBurgmann" },
  { delegate: "Josko Kandido", company: "Venarion Commodities" },
  { delegate: "Karol Kerrane", company: "EPC Engineering & Technologies GmbH" },
  { delegate: "Kateryna Omelchuk", company: "Eramet" },
  { delegate: "Kaustubh Deshpande", company: "iMOTO" },
  { delegate: "Kewei Wu", company: "Zhejiang ENCO Machinery Co.ltd" },
  { delegate: "Lars Hafermann", company: "EPC Engineering & Technologies GmbH" },
  { delegate: "Laura Fazio Bellacchio", company: "European Metals" },
  { delegate: "Laurent Labous", company: "Ipsinov Consulting" },
  { delegate: "Libby Banks", company: "Evove Ltd" },
  { delegate: "Liviu Mantescu", company: "Watergenics" },
  { delegate: "Luis Santillana", company: "Lithium Ark" },
  { delegate: "Mareike Partsch", company: "Fraunhofer IKTS" },
  { delegate: "Marten Huck", company: "Forschungszentrum Jülich GmbH" },
  { delegate: "Mehmet Soner CINAR", company: "Koyuncu Nakliye Pazarlama ve Tic. A.S." },
  { delegate: "Micha Zauner", company: "Deutsche E-Metalle AG" },
  { delegate: "Michael Strobel", company: "P3" },
  { delegate: "Mustafa M. Demir", company: "Izmir Institute of Technology" },
  { delegate: "Natália Olahová", company: "ILF Consulting Engineers Austria GmbH" },
  { delegate: "Osman ŞEN", company: "OSM Grup Enerji Mühendislik İnşaat A.Ş." },
  { delegate: "Paul-Louis Wöhrlin", company: "Fraunhofer ISE" },
  { delegate: "Paw Juul", company: "Lithium Harvest" },
  { delegate: "Pinar Yanar Sozal", company: "OSM Grup Enerji Mühendislik İnşaat A.Ş." },
  { delegate: "Raven Liu", company: "Huawei" },
  { delegate: "René Odenthak", company: "Evonik Operations GmbH" },
  { delegate: "Ross Wilkie", company: "Avocet Battery Materials" },
  { delegate: "Ryan Law", company: "Geothermal Engineering Ltd" },
  { delegate: "Salvatore Pinizzotto", company: "Xida Communications" },
  { delegate: "Simon Gillibrand", company: "Savannah Group" },
  { delegate: "Steffen Garbe", company: "Phlair GmbH" },
  { delegate: "Stephan Wipperfürth", company: "Future Pipe Industries B.V." },
  { delegate: "Stewart Dickson", company: "Weardale Lithum" },
  { delegate: "Stöckl Yannick", company: "TIB Chemicals AG" },
  { delegate: "Süreyya ŞEN", company: "OSM Grup Enerji Mühendislik İnşaat A.Ş." },
  { delegate: "Tom Frising", company: "Axens" },
  { delegate: "Tommaso Ferrari", company: "Turboden" },
  { delegate: "Yağmur ŞEN", company: "OSM Grup Enerji Mühendislik İnşaat A.Ş." },
  { delegate: "Yasin ŞEN", company: "OSM Grup Enerji Mühendislik İnşaat A.Ş." },
  { delegate: "Yefan Pan", company: "Zhejiang ENCO Machinery Co.ltd" },
];

export default function RegisteredDelegatesMobile({
  delegates = DEFAULT_DELEGATES,
  printedOn = process.env.REACT_APP_PRINTED_ON,
}) {
  const navigate = useNavigate();

  return (
    <div
      className="delegates-mobile"
      style={{

        "--delegates-bg": `url(${process.env.PUBLIC_URL}/images/DLE-Folder-BG.png)`,
      }}
    >

      <div className="delegates-mobile__card">
        <div className="delegates-mobile__title_button">
          <button
            type="button"
            className="delegates-mobile__back_button"
            aria-label="Go back"
            onClick={() => navigate("/")}
          >
            <img
              src={backButtonBlack}
              alt=""
              className="delegates-mobile__back_button-icon delegates-mobile__back_button-icon--normal"
            />
            <img
              src={backButtonBlue}
              alt=""
              className="delegates-mobile__back_button-icon delegates-mobile__back_button-icon--hover"
            />
          </button>
          <h1 className="delegates-mobile__title">Registered Attendees</h1>
        </div>

        <div className="delegates-mobile__table-wrap">
          <table className="delegates-mobile__table">
            <thead>
              <tr>
                <th>Company Name</th>
                <th>Delegate Name</th>
              </tr>
            </thead>
            <tbody>
              {delegates.map((row, index) => (
                <tr key={`${row.company}-${row.delegate}-${index}`}>
                  <td>{row.company}</td>
                  <td>{row.delegate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="delegates-mobile__note">
          This attendee list was last updated on {printedOn}. Registrations received after this date are not included. The latest list will be available online and will include all registered participants.
        </p>
      </div>
    </div>
  );
}