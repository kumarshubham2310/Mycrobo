import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { OpenCloneButton } from "@/components/open-clone-button";
import { RelationshipDemo } from "@/components/recovered/relationship-demo-focus-9afb78fa6f";
import { ContactForm } from "@/components/recovered/contact-form-focus-9afb78fa6f";
import { AttentionTabs } from "@/components/attention-tabs";

export const metadata = {
  title: "Product — MyCrobo",
  description:
    "Explore MyCrobo’s focus-first product direction: authorised routine handling, planned reviews, contextual escalation and founder-controlled communication.",
  alternates: { canonical: "/product/" },
  openGraph: {
    title: "Product — MyCrobo",
    description:
      "Explore MyCrobo’s focus-first product direction: authorised routine handling, planned reviews, contextual escalation and founder-controlled communication.",
    url: "/product/",
  },
  twitter: {
    title: "Product — MyCrobo",
    description:
      "Explore MyCrobo’s focus-first product direction: authorised routine handling, planned reviews, contextual escalation and founder-controlled communication.",
  },
};
export default function Page() {
  return (
    <main id="main-content">
      <SiteHeader />
      <section className="inner-hero inner-hero-product">
        <div>
          <p className="eyebrow">{"Starting with founder focus"}</p>
          <h1>{"Stay with your work. Let context guide what reaches you."}</h1>
          <p>
            {
              "We are starting with the conversations that pull founders between tasks. The goal: handle routine communication within permissions, queue what can wait, and surface urgent or important matters at the right time."
            }
          </p>
          <p className="focus-status">
            {
              "These website examples are illustrative. They do not connect to an inbox, handle real messages or suppress device notifications. Channel support and notification controls require separate implementation."
            }
          </p>
        </div>
        <div
          className="product-window"
          aria-label="Illustrative MyCrobo desktop experience"
        >
          <div className="window-bar">
            <i></i>
            <i></i>
            <i></i>
            <span>{"MyCrobo · Illustrative founder workflow"}</span>
          </div>
          <div className="window-body">
            <aside className="mock-sidebar">
              <div className="mock-brand">
                <span>{"M"}</span>
                <b>{"mycrobo"}</b>
              </div>
              <div className="mock-panel-label">{"Intelligence panel"}</div>
              <div className="mock-panel-item selected">
                <span>{"01"}</span>
                <div>
                  <b>{"Conversation state"}</b>
                  <small>{"Story, facts and open questions"}</small>
                </div>
              </div>
              <div className="mock-panel-item ">
                <span>{"02"}</span>
                <div>
                  <b>{"Relationship profile"}</b>
                  <small>{"Colleague · measured"}</small>
                </div>
              </div>
              <div className="mock-panel-item ">
                <span>{"03"}</span>
                <div>
                  <b>{"Relevant memory"}</b>
                  <small>{"Current and same-person evidence"}</small>
                </div>
              </div>
              <div className="mock-panel-item ">
                <span>{"04"}</span>
                <div>
                  <b>{"Reply boundary"}</b>
                  <small>{"No unsupported commitments"}</small>
                </div>
              </div>
              <div className="mock-panel-status">
                <span>{"Example route"}</span>
                <b>{"Coordination"}</b>
                <small>{"Work · pending dependency"}</small>
              </div>
            </aside>
            <div className="mock-conversation">
              <div className="mock-conversation-head">
                <b>{"Elisa - Work"}</b>
                <span>{"Project lead"}</span>
              </div>
              <div className="context-banner">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lucide lucide-shield-check"
                  aria-hidden="true"
                >
                  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path>
                  <path d="m9 12 2 2 4-4"></path>
                </svg>
                <div>
                  <b>{"Known in this example"}</b>
                  <span>
                    {"Costing is pending. No delivery time has been approved."}
                  </span>
                </div>
              </div>
              <div className="mock-messages">
                <div className="mock-bubble theirs">
                  {"Can you send the proposal today?"}
                </div>
                <div className="mock-bubble mine">
                  {"I need costing confirmed before I can commit."}
                </div>
                <div className="mock-bubble theirs">
                  {"Understood. Please confirm when costing is ready."}
                </div>
              </div>
              <div className="mock-draft">
                <div>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="lucide lucide-sparkles"
                    aria-hidden="true"
                  >
                    <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"></path>
                    <path d="M20 2v4"></path>
                    <path d="M22 4h-4"></path>
                    <circle cx="4" cy="20" r="2"></circle>
                  </svg>
                  <b>{"Suggested reply"}</b>
                  <span>{"Relationship-aware"}</span>
                </div>
                <p>
                  {
                    "Costing is still pending, so I can’t confirm a delivery time yet."
                  }
                </p>
                <footer>
                  <span>{"Illustrative draft · owner approval required"}</span>
                  <button
                    type="button"
                    disabled
                    title="Illustration only. No message is sent."
                  >
                    {"Draft preview"}
                  </button>
                </footer>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="section attention-section" id="attention">
        <div className="attention-copy">
          <p className="eyebrow">{"Protect attention, not just the inbox"}</p>
          <h2>{"What needs you—when it needs you."}</h2>
          <p>
            {
              "A routine acknowledgement should not interrupt your work. Important but non-urgent tasks belong in a planned review. Time-sensitive decisions need a clear reason to reach you now. No reply does not mean no task."
            }
          </p>
        </div>
        <AttentionTabs />
      </section>
      <section className="section product-detail-section">
        <div className="section-kicker">
          <span>{"From interruption to the right next step"}</span>
          <p>
            {
              "The goal is not more replies. It is fewer unnecessary switches, with important work still visible."
            }
          </p>
        </div>
        <div className="product-detail-grid">
          <article>
            <span>{"01"}</span>
            <h2>{"Understand the situation"}</h2>
            <p>
              {
                "Identify the person, current facts, commitments and unfinished work behind the message."
              }
            </p>
          </article>
          <article>
            <span>{"02"}</span>
            <h2>{"Decide whether you are needed"}</h2>
            <p>
              {
                "Use context, timing and consequences—not just the word “urgent”—to decide whether your judgment is needed."
              }
            </p>
          </article>
          <article>
            <span>{"03"}</span>
            <h2>{"Handle, queue or escalate"}</h2>
            <p>
              {
                "Handle approved routine communication, hold non-urgent updates for review, and surface decisions that need you."
              }
            </p>
          </article>
          <article>
            <span>{"04"}</span>
            <h2>{"Keep you in control"}</h2>
            <p>
              {
                "Keep an activity record, review sensitive actions and approve new commitments. No invented deadlines or approvals."
              }
            </p>
          </article>
        </div>
        <div id="prompt-assistance" className="focus-prompt">
          <p className="eyebrow">
            {"Planned capability · natural-language prompting"}
          </p>
          <h2>{"Explain the task your way. Give AI the context it needs."}</h2>
          <p>
            {
              "The same understanding should also reduce the work of instructing AI. We plan to turn your natural instructions into a clear prompt, using only the relevant context you approve."
            }
          </p>
          <div className="focus-prompt-grid">
            <article>
              <h3>{"You say"}</h3>
              <p>
                {
                  "“Help me respond to this client in my usual tone. Costing is pending, so don’t promise a delivery date.”"
                }
              </p>
            </article>
            <article>
              <h3>{"The prompt keeps"}</h3>
              <p>
                {
                  "The task, approved facts, your communication style, the missing costing confirmation and a clear boundary: do not invent a deadline. Ask only for information genuinely needed."
                }
              </p>
            </article>
          </div>
          <p className="focus-status">
            {
              "Planned—not connected to an AI model on this website. Private relationship details should not be carried into an unrelated prompt."
            }
          </p>
        </div>
      </section>
      <div id="personal-autonomy" className="personal-autonomy-block">
        <section className="inner-hero control-hero product-autonomy-hero">
          <div>
            <p className="eyebrow">{"Personal Autonomy"}</p>
            <h2>{"You hold all the cards."}</h2>
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
        <p className="eyebrow eyebrow-light">{"Continue"}</p>
        <h2>{"The difference is knowing when you need to be involved."}</h2>
        <Link className="button button-lime" href="/why-mycrobo/">
          {"Explore Why MyCrobo "}
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
