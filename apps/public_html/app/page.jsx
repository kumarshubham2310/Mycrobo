import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { OpenCloneButton } from "@/components/open-clone-button";
import { RelationshipDemo } from "@/components/recovered/relationship-demo-focus-9afb78fa6f";
import { ContactForm } from "@/components/recovered/contact-form-focus-9afb78fa6f";
import { AttentionTabs } from "@/components/attention-tabs";

export const metadata = {
  title: "MyCrobo — Stay focused. Stay present.",
  description:
    "MyCrobo is building relationship-aware AI to protect founder focus, handle authorised routine communication and surface what genuinely needs attention.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "MyCrobo — Stay focused. Stay present.",
    description:
      "MyCrobo is building relationship-aware AI to protect founder focus, handle authorised routine communication and surface what genuinely needs attention.",
    url: "/",
  },
  twitter: {
    title: "MyCrobo — Stay focused. Stay present.",
    description:
      "MyCrobo is building relationship-aware AI to protect founder focus, handle authorised routine communication and surface what genuinely needs attention.",
  },
};
export default function Page() {
  return (
    <main id="main-content">
      <SiteHeader />
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">{"Built for founders. Designed for focus."}</p>
          <h1>{"Stay focused. Without letting important things slip."}</h1>
          <p className="hero-intro">
            {
              "MyCrobo is being built to handle routine communication within your permissions, hold what can wait, and bring forward what genuinely needs your judgment—so you can stay with the work you chose."
            }
          </p>
          <div className="hero-actions">
            <OpenCloneButton className="button">
              {"Meet MyCrobo "}
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
            </OpenCloneButton>
            <Link className="text-link" href="/product/#attention">
              {"See the focus workflow "}
              <span aria-hidden="true">{"→"}</span>
            </Link>
          </div>
          <p className="hero-note">
            {"Your context. Your permissions. Your focus."}
          </p>
        </div>
        <div
          className="hero-visual"
          aria-label="Illustrative founder workflow: routine communication, planned review and a time-sensitive decision"
        >
          <div className="orbit orbit-one"></div>
          <div className="orbit orbit-two"></div>
          <div className="context-pill context-family">
            <span>{"Routine"}</span>
            <b>{"Handle with permission"}</b>
          </div>
          <div className="context-pill context-work">
            <span>{"Can wait"}</span>
            <b>{"Next review"}</b>
          </div>
          <div className="context-pill context-friend">
            <span>{"Needs you"}</span>
            <b>{"Time-sensitive decision"}</b>
          </div>
          <article className="conversation-card">
            <div className="conversation-head">
              <div className="avatar">{"M"}</div>
              <div>
                <strong>{"While you focus"}</strong>
                <span>{"Founder workflow"}</span>
              </div>
              <span className="live-dot">{"Concept"}</span>
            </div>
            <div className="message incoming">
              {
                "Three messages arrive: a receipt, a project update and a time-sensitive approval."
              }
            </div>
            <div className="thinking">
              <span></span>
              {" Context decides the next step"}
            </div>
            <div className="message outgoing">
              {
                "Acknowledge the receipt. Save the update for review. Bring you the approval."
              }
            </div>
            <div className="draft-label">
              {"Illustrative workflow · permissions required"}
            </div>
          </article>
        </div>
      </section>
      <section className="intro-strip">
        <p>{"What can be handled, gets handled. What can wait, waits."}</p>
        <strong>{"What needs you, reaches you."}</strong>
      </section>
      <section className="section home-paths">
        <div className="home-paths-heading">
          <p className="eyebrow">{"Explore MyCrobo"}</p>
          <h2>{"Less switching. More attention for what matters."}</h2>
        </div>
        <div className="home-path-grid">
          <Link href="/product/">
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
              className="lucide lucide-message-circle"
              aria-hidden="true"
            >
              <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"></path>
            </svg>
            <span>{"01"}</span>
            <h3>{"The product"}</h3>
            <p>
              {
                "See how conversation context can separate routine communication from work that needs you."
              }
            </p>
            <b>
              {"Explore product "}
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
                className="lucide lucide-arrow-right"
                aria-hidden="true"
              >
                <path d="M5 12h14"></path>
                <path d="m12 5 7 7-7 7"></path>
              </svg>
            </b>
          </Link>
          <Link href="/why-mycrobo/">
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
            <span>{"02"}</span>
            <h3>{"Why MyCrobo"}</h3>
            <p>
              {
                "See why relationships, commitments and timing matter—not just the wording of a reply."
              }
            </p>
            <b>
              {"See the difference "}
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
                className="lucide lucide-arrow-right"
                aria-hidden="true"
              >
                <path d="M5 12h14"></path>
                <path d="m12 5 7 7-7 7"></path>
              </svg>
            </b>
          </Link>
          <Link href="/vision/">
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
              className="lucide lucide-video"
              aria-hidden="true"
            >
              <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"></path>
              <rect x="2" y="6" width="14" height="12" rx="2"></rect>
            </svg>
            <span>{"03"}</span>
            <h3>{"The vision"}</h3>
            <p>
              {
                "Follow the focus-first journey from messaging to voice and a permissioned visual twin."
              }
            </p>
            <b>
              {"See the direction "}
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
                className="lucide lucide-arrow-right"
                aria-hidden="true"
              >
                <path d="M5 12h14"></path>
                <path d="m12 5 7 7-7 7"></path>
              </svg>
            </b>
          </Link>
          <Link href="/product/#personal-autonomy">
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
              className="lucide lucide-shield-check"
              aria-hidden="true"
            >
              <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path>
              <path d="m9 12 2 2 4-4"></path>
            </svg>
            <span>{"04"}</span>
            <h3>{"Personal Autonomy"}</h3>
            <p>
              {
                "You hold all the cards: see the permissions and relationship boundaries designed into the product."
              }
            </p>
            <b>
              {"Review your controls "}
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
                className="lucide lucide-arrow-right"
                aria-hidden="true"
              >
                <path d="M5 12h14"></path>
                <path d="m12 5 7 7-7 7"></path>
              </svg>
            </b>
          </Link>
        </div>
      </section>
      <section className="home-human-section">
        <div className="home-human-photo">
          <Image
            src="/images/mycrobo-human-moment.webp"
            alt="A fictional couple reconnecting over dinner"
            loading="lazy"
            decoding="async"
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
            fill
            sizes="100vw"
          />
        </div>
        <div className="home-human-copy">
          <p className="eyebrow eyebrow-light">
            {"Protect the work. Preserve the relationship."}
          </p>
          <h2>{"Be present—without being pulled into everything."}</h2>
          <p>
            {
              "A proposal, a payment, a message, then back to the proposal. The goal is fewer unnecessary switches—so both your work and the person in front of you get your attention."
            }
          </p>
          <Link className="button button-lime" href="/vision/">
            {"Explore the vision "}
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
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
