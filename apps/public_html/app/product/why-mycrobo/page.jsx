import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { OpenCloneButton } from "@/components/open-clone-button";
import { RelationshipDemo } from "@/components/recovered/relationship-demo-focus-9afb78fa6f";
import { ContactForm } from "@/components/recovered/contact-form-focus-9afb78fa6f";
import { AttentionTabs } from "@/components/attention-tabs";

export const metadata = {
  title: "Why MyCrobo",
  description:
    "Relationship profiles, communication DNA, and 1,500 scenario cells help MyCrobo adapt to the person and the moment.",
  alternates: { canonical: "/product/why-mycrobo/" },
  openGraph: {
    title: "Why MyCrobo",
    description:
      "Relationship profiles, communication DNA, and 1,500 scenario cells help MyCrobo adapt to the person and the moment.",
    url: "/product/why-mycrobo/",
  },
  twitter: {
    title: "Why MyCrobo",
    description:
      "Relationship profiles, communication DNA, and 1,500 scenario cells help MyCrobo adapt to the person and the moment.",
  },
};
export default function Page() {
  return (
    <main id="main-content">
      <SiteHeader />
      <section className="inner-hero compact-inner-hero">
        <div>
          <p className="eyebrow">{"The relationship layer"}</p>
          <h1>
            {"You already have more than one voice. All of them are you."}
          </h1>
          <p>
            {
              "What sounds caring to a parent may sound unusual at work. What feels natural with a close friend may be too familiar for a new client. MyCrobo learns the difference."
            }
          </p>
        </div>
      </section>
      <section className="section relationship-page-section">
        <RelationshipDemo />
      </section>
      <section className="section scenario-section">
        <div className="scenario-copy">
          <p className="eyebrow eyebrow-light">{"The scenario architecture"}</p>
          <h2>{"Built to notice the situation around the words."}</h2>
          <p>
            {
              "MyCrobo organises communication across 1,500 scenario cells so an urgent request from a parent is not treated like a casual update from a client."
            }
          </p>
          <p className="scenario-note">
            {
              "This routes the current situation. It does not put a permanent label on a person."
            }
          </p>
        </div>
        <div
          className="equation"
          aria-label="15 interaction tones times 10 relationship types times 10 communication modes equals 1,500 scenario cells"
        >
          <div>
            <b>{"15"}</b>
            <span>{"interaction tones"}</span>
          </div>
          <i>{"×"}</i>
          <div>
            <b>{"10"}</b>
            <span>{"relationship types"}</span>
          </div>
          <i>{"×"}</i>
          <div>
            <b>{"10"}</b>
            <span>{"communication modes"}</span>
          </div>
          <i>{"="}</i>
          <div className="equation-total">
            <b>{"1,500"}</b>
            <span>{"scenario cells"}</span>
          </div>
        </div>
        <div className="scenario-cube-showcase">
          <Image
            src="/images/mycrobo_communication_cube.webp"
            alt="Three-dimensional scenario cube showing 15 interaction tones, 10 relationship types, and 10 communication modes totaling 1,500 scenario cells."
            loading="lazy"
            decoding="async"
            fill
            sizes="100vw"
          />
        </div>
      </section>
      <section className="section dna-section">
        <div className="dna-heading">
          <p className="eyebrow">{"Your communication DNA"}</p>
          <h2>
            {"A living model of how you express judgment, care and intent."}
          </h2>
          <p>
            {
              "Accuracy does not come from copying a few phrases. It comes from evidence-backed patterns that remain open to correction."
            }
          </p>
        </div>
        <div className="dna-layout">
          <div className="dna-orbit">
            <div className="dna-center">
              <Image
                src="/images/mycrobo-mark.webp"
                alt=""
                width={88}
                height={88}
                loading="lazy"
                decoding="async"
              />
              <div>
                <span>{"Identity core"}</span>
                <b>{"Your communication model"}</b>
                <small>{"Continuously refined from approved evidence"}</small>
              </div>
            </div>
            <div className="dna-node-grid">
              <span className="dna-node node-one">
                <b>{"Tone"}</b>
                <small>{"How it sounds"}</small>
              </span>
              <span className="dna-node node-two">
                <b>{"Timing"}</b>
                <small>{"When you respond"}</small>
              </span>
              <span className="dna-node node-three">
                <b>{"Language"}</b>
                <small>{"Words and rhythm"}</small>
              </span>
              <span className="dna-node node-four">
                <b>{"Boundaries"}</b>
                <small>{"What stays separate"}</small>
              </span>
            </div>
            <p className="dna-panel-note">
              {
                "Each signal can change by relationship without changing who you are."
              }
            </p>
          </div>
          <div className="dna-signals">
            <article>
              <span>{"01"}</span>
              <div>
                <h3>{"Language"}</h3>
                <p>{"English, Hindi, Gujarati and the way you mix them"}</p>
              </div>
            </article>
            <article>
              <span>{"02"}</span>
              <div>
                <h3>{"Brevity"}</h3>
                <p>{"When you answer in a word—and when you explain"}</p>
              </div>
            </article>
            <article>
              <span>{"03"}</span>
              <div>
                <h3>{"Warmth"}</h3>
                <p>
                  {"How affection, reassurance and care sound in your voice"}
                </p>
              </div>
            </article>
            <article>
              <span>{"04"}</span>
              <div>
                <h3>{"Formality"}</h3>
                <p>{"How your register shifts by person, place and purpose"}</p>
              </div>
            </article>
            <article>
              <span>{"05"}</span>
              <div>
                <h3>{"Humour"}</h3>
                <p>
                  {"Your teasing, timing, restraint and recurring patterns"}
                </p>
              </div>
            </article>
            <article>
              <span>{"06"}</span>
              <div>
                <h3>{"Emoji rhythm"}</h3>
                <p>{"Which ones you use, with whom, and how often"}</p>
              </div>
            </article>
            <article>
              <span>{"07"}</span>
              <div>
                <h3>{"Commitments"}</h3>
                <p>
                  {"How you confirm, defer, decline and avoid overpromising"}
                </p>
              </div>
            </article>
            <article>
              <span>{"08"}</span>
              <div>
                <h3>{"Silence"}</h3>
                <p>
                  {"The situations where your most natural reply is no reply"}
                </p>
              </div>
            </article>
          </div>
        </div>
        <div className="accuracy-band">
          <strong>{"How it becomes more accurate"}</strong>
          <div>
            <span>{"1"}</span>
            {"Direct evidence from the same person"}
          </div>
          <div>
            <span>{"2"}</span>
            {"Relationship-specific patterns"}
          </div>
          <div>
            <span>{"3"}</span>
            {"Your corrections and edits"}
          </div>
          <div>
            <span>{"4"}</span>
            {"Conversation-wide backtesting"}
          </div>
        </div>
      </section>
      <section className="page-cta">
        <p className="eyebrow eyebrow-light">{"Continue"}</p>
        <h2>{"See where messaging can lead next."}</h2>
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
      </section>
      <SiteFooter />
    </main>
  );
}
