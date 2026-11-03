import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { OpenCloneButton } from "@/components/open-clone-button";
import { RelationshipDemo } from "@/components/recovered/relationship-demo-focus-9afb78fa6f";
import { ContactForm } from "@/components/recovered/contact-form-focus-9afb78fa6f";
import { AttentionTabs } from "@/components/attention-tabs";

export const metadata = {
  title: "Vision — MyCrobo",
  description:
    "MyCrobo’s focus-first vision: relationship-aware messaging, planned voice capabilities and a permissioned visual digital twin.",
  alternates: { canonical: "/vision/" },
  openGraph: {
    title: "Vision — MyCrobo",
    description:
      "MyCrobo’s focus-first vision: relationship-aware messaging, planned voice capabilities and a permissioned visual digital twin.",
    url: "/vision/",
  },
  twitter: {
    title: "Vision — MyCrobo",
    description:
      "MyCrobo’s focus-first vision: relationship-aware messaging, planned voice capabilities and a permissioned visual digital twin.",
  },
};
export default function Page() {
  return (
    <main id="main-content">
      <SiteHeader />
      <section className="vision-page-hero">
        <div className="vision-copy">
          <p className="eyebrow eyebrow-light">{"One vision. Focus first."}</p>
          <h1>{"A digital extension of you. More attention for your life."}</h1>
          <p className="vision-intro">
            {
              "We are building toward a permissioned digital twin that understands your relationships, commitments and way of communicating. The purpose is not to make you available everywhere. It is to protect your attention without letting important responsibilities slip."
            }
          </p>
          <div className="vision-steps">
            <OpenCloneButton className="vision-step-trigger current">
              <span>{"First"}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
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
              <div>
                <h3>{"Protect focus in messaging"}</h3>
                <p>
                  {
                    "Start with context, routine handling and the right moment to involve you."
                  }
                </p>
                <b>
                  {"Meet MyCrobo "}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="13"
                    height="13"
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
              </div>
            </OpenCloneButton>
            <article>
              <span>{"Next"}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-mic-vocal"
                aria-hidden="true"
              >
                <path d="m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12"></path>
                <path d="M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5"></path>
                <circle cx="16" cy="7" r="5"></circle>
              </svg>
              <div>
                <h3>{"Carry context into voice"}</h3>
                <p>
                  {
                    "Planned: handle permitted conversations in your voice and return important decisions to you."
                  }
                </p>
              </div>
            </article>
            <article>
              <span>{"Vision"}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
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
              <div>
                <h3>{"A permissioned visual twin"}</h3>
                <p>
                  {
                    "Longer-term vision: disclosed visual presence in selected conversations, within your boundaries."
                  }
                </p>
              </div>
            </article>
          </div>
        </div>
        <div
          className="presence-visual"
          aria-label="Concept for a future MyCrobo video conversation"
        >
          <div className="presence-halo halo-a"></div>
          <div className="presence-halo halo-b"></div>
          <div className="video-frame">
            <div className="video-person">
              <Image
                src="/images/mycrobo-call-main.webp"
                alt="A fictional MyCrobo owner in a future video conversation"
                loading="lazy"
                decoding="async"
                className="video-person-photo"
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
              <div className="voice-wave">
                <i style={{ height: "18px" }}></i>
                <i style={{ height: "32px" }}></i>
                <i style={{ height: "48px" }}></i>
                <i style={{ height: "25px" }}></i>
                <i style={{ height: "54px" }}></i>
                <i style={{ height: "40px" }}></i>
                <i style={{ height: "20px" }}></i>
                <i style={{ height: "46px" }}></i>
                <i style={{ height: "29px" }}></i>
                <i style={{ height: "38px" }}></i>
                <i style={{ height: "17px" }}></i>
                <i style={{ height: "31px" }}></i>
              </div>
              <div className="video-caption">
                <span className="status-dot"></span>
                {" MyCrobo"}
              </div>
            </div>
            <div className="caller-tile">
              <Image
                src="/images/mycrobo-call-caller.webp"
                alt="A fictional partner in the call"
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
              <span>{"Babes 😘🥰"}</span>
            </div>
            <div className="call-controls">
              <span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lucide lucide-mic-vocal"
                  aria-hidden="true"
                >
                  <path d="m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12"></path>
                  <path d="M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5"></path>
                  <circle cx="16" cy="7" r="5"></circle>
                </svg>
              </span>
              <span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
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
              </span>
              <span className="end-call">{"×"}</span>
            </div>
          </div>
          <div className="presence-note">
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
              className="lucide lucide-heart"
              aria-hidden="true"
            >
              <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"></path>
            </svg>
            <span>
              <b>{"Relationship recognised"}</b>
              {"Babes 😘🥰 · warm · reassuring"}
            </span>
          </div>
        </div>
      </section>
      <section className="vision-life-section">
        <figure>
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
        </figure>
        <div>
          <p className="eyebrow eyebrow-light">
            {"What technology should protect"}
          </p>
          <h2>{"More attention for the work and people in front of you."}</h2>
          <p>
            {
              "The goal is to reduce avoidable task-switching—not to remove you from the relationships that matter. Routine communication should support your presence, not compete with it."
            }
          </p>
        </div>
      </section>
      <section className="section vision-principles">
        <div>
          <p className="eyebrow">
            {"The product must grow in the right order"}
          </p>
          <h2>{"Capability follows permission."}</h2>
        </div>
        <div className="vision-principle-grid">
          <article>
            <span>{"01"}</span>
            <h3>{"Learn before acting"}</h3>
            <p>
              {
                "Start with messaging and test contextual understanding, fewer interruptions and reliable follow-through before expanding autonomy."
              }
            </p>
          </article>
          <article>
            <span>{"02"}</span>
            <h3>{"Voice before appearance"}</h3>
            <p>
              {
                "Voice should preserve meaning, boundaries and appropriate escalation before visual presence makes it more convincing."
              }
            </p>
          </article>
          <article>
            <span>{"03"}</span>
            <h3>{"Boundaries before autonomy"}</h3>
            <p>
              {
                "You choose where the twin may participate, what can wait, and which decisions or sensitive actions must return to you."
              }
            </p>
          </article>
        </div>
      </section>
      <section className="page-cta">
        <p className="eyebrow eyebrow-light">{"Continue"}</p>
        <h2>{"See how you hold all the cards."}</h2>
        <Link className="button button-lime" href="/product/#personal-autonomy">
          {"Explore Personal Autonomy "}
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
