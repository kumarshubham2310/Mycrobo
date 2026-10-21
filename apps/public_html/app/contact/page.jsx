import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { OpenCloneButton } from "@/components/open-clone-button";
import { RelationshipDemo } from "@/components/recovered/relationship-demo-focus-9afb78fa6f";
import { ContactForm } from "@/components/recovered/contact-form-focus-9afb78fa6f";
import { AttentionTabs } from "@/components/attention-tabs";

export const metadata = {
  title: "Contact — MyCrobo",
  description:
    "Contact MyCrobo about founder early access, recurring interruptions, communication workflows, design partnership or the digital-twin vision.",
  alternates: { canonical: "/contact/" },
  openGraph: {
    title: "Contact — MyCrobo",
    description:
      "Contact MyCrobo about founder early access, recurring interruptions, communication workflows, design partnership or the digital-twin vision.",
    url: "/contact/",
  },
  twitter: {
    title: "Contact — MyCrobo",
    description:
      "Contact MyCrobo about founder early access, recurring interruptions, communication workflows, design partnership or the digital-twin vision.",
  },
};
export default function Page() {
  return (
    <main id="main-content">
      <SiteHeader />
      <section className="contact-page">
        <div className="contact-intro">
          <p className="eyebrow">{"Help shape founder focus"}</p>
          <h1>
            {"What keeps pulling you away from your most important work?"}
          </h1>
          <p>
            {
              "Tell us which recurring conversations interrupt your work, which channel they arrive on, and what must always need your approval. Start with one workflow: client commitments, team questions or follow-ups."
            }
          </p>
          <div className="contact-points">
            <span>{"Founder early access"}</span>
            <span>{"Design partnership"}</span>
            <span>{"Business collaboration"}</span>
            <span>{"Product feedback"}</span>
          </div>
        </div>
        <ContactForm />
      </section>
      <SiteFooter />
    </main>
  );
}
