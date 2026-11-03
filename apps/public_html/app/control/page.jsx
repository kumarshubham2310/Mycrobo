import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { OpenCloneButton } from "@/components/open-clone-button";
import { RelationshipDemo } from "@/components/recovered/relationship-demo-focus-9afb78fa6f";
import { ContactForm } from "@/components/recovered/contact-form-focus-9afb78fa6f";
import { AttentionTabs } from "@/components/attention-tabs";

export const metadata = {
  title: "Personal Autonomy — MyCrobo",
  description:
    "Explore the intended MyCrobo controls for routine handling, review windows, escalation, relationship boundaries, memory and owner approval.",
  alternates: { canonical: "/control/" },
  openGraph: {
    title: "Personal Autonomy — MyCrobo",
    description:
      "Explore the intended MyCrobo controls for routine handling, review windows, escalation, relationship boundaries, memory and owner approval.",
    url: "/control/",
  },
  twitter: {
    title: "Personal Autonomy — MyCrobo",
    description:
      "Explore the intended MyCrobo controls for routine handling, review windows, escalation, relationship boundaries, memory and owner approval.",
  },
};
export default function Page() {
  return (
    <main id="main-content">
      <SiteHeader />
      <div id="personal-autonomy" className="personal-autonomy-block">
        <section className="inner-hero control-hero product-autonomy-hero">
          <div>
            <p className="eyebrow">{"Personal Autonomy"}</p>
            <h1>{"You hold all the cards."}</h1>
            <p>
              {
                "Protecting your focus must not mean giving up control. MyCrobo is being designed around what may be handled, what can wait, and what must come back to you."
              }
            </p>
          </div>
          <div className="control-panel">
            <div className="control-panel-head">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-lock-keyhole"
                aria-hidden="true"
              >
                <circle cx="12" cy="16" r="1"></circle>
                <rect x="3" y="10" width="18" height="12" rx="2"></rect>
                <path d="M7 10V7a5 5 0 0 1 10 0v3"></path>
              </svg>
              <div>
                <b>{"Owner controls"}</b>
                <span>{"Illustrative product direction"}</span>
              </div>
            </div>
            <div className="control-row">
              <span>{"Draft replies"}</span>
              <b>{"On"}</b>
            </div>
            <div className="control-row">
              <span>{"Send without review"}</span>
              <b>{"Off"}</b>
            </div>
            <div className="control-row">
              <span>{"Use relationship memory"}</span>
              <b>{"On"}</b>
            </div>
            <div className="control-row">
              <span>{"Cross-relationship disclosure"}</span>
              <b>{"Blocked"}</b>
            </div>
            <div className="control-row">
              <span>{"Voice and likeness"}</span>
              <b>{"Not enabled"}</b>
            </div>
          </div>
        </section>
        <section className="section control-section">
          <div className="control-heading">
            <p className="eyebrow">{"Concrete boundaries"}</p>
            <h2>{"What the owner should be able to choose."}</h2>
          </div>
          <div className="control-grid">
            <article>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="23"
                height="23"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-key-round"
                aria-hidden="true"
              >
                <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"></path>
                <circle cx="16.5" cy="7.5" r=".5" fill="currentColor"></circle>
              </svg>
              <span>{"01"}</span>
              <h3>{"Identity ownership"}</h3>
              <p>
                {
                  "Your voice, likeness, memories and communication patterns remain connected to your account and your choices."
                }
              </p>
            </article>
            <article>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="23"
                height="23"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-users"
                aria-hidden="true"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                <path d="M16 3.128a4 4 0 0 1 0 7.744"></path>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                <circle cx="9" cy="7" r="4"></circle>
              </svg>
              <span>{"02"}</span>
              <h3>{"Relationship boundaries"}</h3>
              <p>
                {
                  "Memory from one relationship is not used as private information in another relationship."
                }
              </p>
            </article>
            <article>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="23"
                height="23"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-sliders-horizontal"
                aria-hidden="true"
              >
                <path d="M10 5H3"></path>
                <path d="M12 19H3"></path>
                <path d="M14 3v4"></path>
                <path d="M16 17v4"></path>
                <path d="M21 12h-9"></path>
                <path d="M21 19h-5"></path>
                <path d="M21 5h-7"></path>
                <path d="M8 10v4"></path>
                <path d="M8 12H3"></path>
              </svg>
              <span>{"03"}</span>
              <h3>{"Action permissions"}</h3>
              <p>
                {
                  "Choose what may be handled, what must wait for review, and what may interrupt you. Sensitive actions still require your approval."
                }
              </p>
            </article>
            <article>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="23"
                height="23"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-brain"
                aria-hidden="true"
              >
                <path d="M12 18V5"></path>
                <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"></path>
                <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"></path>
                <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"></path>
                <path d="M18 18a4 4 0 0 0 2-7.464"></path>
                <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"></path>
                <path d="M6 18a4 4 0 0 1-2-7.464"></path>
                <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"></path>
              </svg>
              <span>{"04"}</span>
              <h3>{"Correctable learning"}</h3>
              <p>
                {
                  "Edits can refine the model without turning one response or one emotional moment into a permanent trait."
                }
              </p>
            </article>
          </div>
        </section>
        <section className="section control-detail">
          <div>
            <p className="eyebrow">{"No hidden leap"}</p>
            <h2>{"From interruption to action, one permission at a time."}</h2>
          </div>
          <ol>
            <li>
              <span>{"1"}</span>
              <div>
                <b>{"See the evidence"}</b>
                <p>
                  {
                    "See the conversation facts, pending commitment and reason a recommendation needs your attention."
                  }
                </p>
              </div>
            </li>
            <li>
              <span>{"2"}</span>
              <div>
                <b>{"Change the recommendation"}</b>
                <p>
                  {
                    "Edit, discard, or teach MyCrobo what was wrong without sending anything."
                  }
                </p>
              </div>
            </li>
            <li>
              <span>{"3"}</span>
              <div>
                <b>{"Choose the attention rules"}</b>
                <p>
                  {
                    "Set review windows for non-urgent work and escalation rules for matters that genuinely need you now. Keep sensitive actions in review-only mode."
                  }
                </p>
              </div>
            </li>
            <li>
              <span>{"4"}</span>
              <div>
                <b>{"Turn access off"}</b>
                <p>
                  {
                    "Disconnect a source or disable a capability. The intended boundary is to hold activity until that source is reconnected."
                  }
                </p>
              </div>
            </li>
          </ol>
        </section>
      </div>
      <section className="page-cta">
        <p className="eyebrow eyebrow-light">{"Talk with us"}</p>
        <h2>{"What must always need your approval?"}</h2>
        <Link className="button button-lime" href="/contact/">
          {"Share your view "}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-arrow-right"
            aria-hidden="true"
          >
            <path d="M5 12h14"></path>
            <path d="m12 5 7 7-7 7"></path>
          </svg>
        </Link>
      </section>
      <SiteFooter />
    </main>
  );
}
