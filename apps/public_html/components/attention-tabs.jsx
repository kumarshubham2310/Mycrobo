"use client";
import * as W from "react/jsx-runtime";
import { Tabs } from "@base-ui/react/tabs";
import {
  UserRound as l,
  CircleCheck as a,
  Clock3 as s,
  Pause as c,
  BellRing as o,
} from "lucide-react";
const Sr = Tabs.Root,
  wr = Tabs.List,
  Tr = Tabs.Tab,
  Er = Tabs.Panel;
var Dr = {
  decision: {
    icon: l,
    count: 1,
    label: `Decisions`,
    eyebrow: `Needs you now · decision`,
    title: `A time-sensitive approval`,
    message: `“May I approve this price exception? The client call starts in 20 minutes.”`,
    note: `Only the founder can approve the exception. Bring forward the decision and its timing—not a guessed approval.`,
    action: `Needs you now`,
  },
  task: {
    icon: a,
    count: 2,
    label: `Your tasks`,
    eyebrow: `Next review · your task`,
    title: `Important work stays visible`,
    message: `Review the proposal at your planned check-in`,
    note: `Important, not urgent: keep your task for the planned review rather than creating another interruption.`,
    action: `Next review`,
  },
  follow: {
    icon: s,
    count: 1,
    label: `Follow-ups`,
    eyebrow: `Wait until due · follow-up`,
    title: `Do not chase before the promise is due`,
    message: `Your teammate promised the costing update tomorrow`,
    note: `Wait for the promised update. Their commitment remains a follow-up, not a new task assigned to you.`,
    action: `Wait until due`,
  },
  quiet: {
    icon: c,
    count: 8,
    label: `No reply`,
    eyebrow: `Handled · no open action`,
    title: `No interruption needed`,
    message: `A routine confirmation has already been acknowledged`,
    note: `Example: an acknowledgement handled within approved permissions. No reply and no unresolved task remain.`,
    action: `Handled with permission`,
  },
};
function Or() {
  return (0, W.jsxs)(`div`, {
    className: `attention-board`,
    children: [
      (0, W.jsxs)(`div`, {
        className: `board-top`,
        children: [
          (0, W.jsxs)(`div`, {
            children: [
              (0, W.jsx)(`span`, { children: `Illustrative attention queues` }),
              (0, W.jsx)(`b`, { children: `What needs you—and when` }),
            ],
          }),
          (0, W.jsxs)(`small`, {
            children: [(0, W.jsx)(a, { size: 13 }), ` Concept example`],
          }),
        ],
      }),
      (0, W.jsxs)(Sr, {
        defaultValue: `decision`,
        className: `attention-tabs`,
        children: [
          (0, W.jsx)(wr, {
            className: `attention-tab-list`,
            "aria-label": `Message attention categories`,
            children: Object.keys(Dr).map((e) => {
              let t = Dr[e],
                n = t.icon;
              return (0, W.jsxs)(
                Tr,
                {
                  className: `attention-tab`,
                  value: e,
                  children: [
                    (0, W.jsx)(n, { size: 15 }),
                    (0, W.jsx)(`span`, { children: t.label }),
                    (0, W.jsx)(`b`, { children: t.count }),
                  ],
                },
                e,
              );
            }),
          }),
          Object.keys(Dr).map((e) => {
            let t = Dr[e],
              n = t.icon;
            return (0, W.jsxs)(
              Er,
              {
                className: `attention-tab-panel`,
                value: e,
                children: [
                  (0, W.jsx)(`div`, {
                    className: `attention-panel-icon`,
                    children: (0, W.jsx)(n, { size: 21 }),
                  }),
                  (0, W.jsxs)(`div`, {
                    className: `attention-panel-copy`,
                    children: [
                      (0, W.jsx)(`span`, { children: t.eyebrow }),
                      (0, W.jsx)(`h3`, { children: t.title }),
                      (0, W.jsx)(`blockquote`, { children: t.message }),
                      (0, W.jsx)(`p`, { children: t.note }),
                    ],
                  }),
                  (0, W.jsxs)(`div`, {
                    className: `attention-panel-action`,
                    children: [
                      (0, W.jsx)(o, { size: 14 }),
                      (0, W.jsx)(`span`, { children: t.action }),
                    ],
                  }),
                ],
              },
              e,
            );
          }),
        ],
      }),
    ],
  });
}
export { Or as AttentionTabs };
