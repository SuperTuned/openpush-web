/**
 * The slide-in prompt's content: ask (message, optional topics, Not now and Allow),
 * topics update for a subscribed person (their current choices, Cancel and Save), or the Home
 * Screen steps on an iPhone or iPad tab (Not now only). Topics are tags: checked "1", unchecked "0".
 */
import type { Topic } from "../config";
import type { SlideInStrings } from "../i18n/strings";
import type { PushAsk } from "../rules";
import type { Card } from "./card";
import { button, el } from "./dom";

export type TopicTags = Record<string, "1" | "0">;

export interface SlideInView {
  mode: PushAsk;
  text: SlideInStrings;
  topics: readonly Topic[];
  /** The person's tags now (for the topics update). */
  current: Record<string, string>;
}

export interface SlideInActions {
  /** Allow. Runs inside the click handler, so the tap is the gesture. */
  allow(tags: TopicTags | undefined): void;
  /** Not now, Cancel, Escape. */
  later(): void;
  /** Save on the topics update. */
  save(tags: TopicTags): void;
}

function topicList(doc: Document, topics: readonly Topic[], checked: (tag: string) => boolean): { node: HTMLElement; read(): TopicTags } {
  const list = el(doc, "fieldset", "topics");
  const boxes: [string, HTMLInputElement][] = [];
  for (const topic of topics) {
    const label = el(doc, "label", "check");
    const box = el(doc, "input");
    box.type = "checkbox";
    box.checked = checked(topic.tag);
    label.appendChild(box);
    label.appendChild(el(doc, "span", undefined, topic.label));
    list.appendChild(label);
    boxes.push([topic.tag, box]);
  }
  return {
    node: list,
    read: () => {
      const tags: TopicTags = {};
      for (const [tag, box] of boxes) tags[tag] = box.checked ? "1" : "0";
      return tags;
    },
  };
}

export function fillSlideIn(card: Card, view: SlideInView, actions: SlideInActions): void {
  const doc = card.doc;
  const { text, mode } = view;
  if (mode === "home_screen") {
    card.setMessage(text.ios_message);
    const steps = el(doc, "ol", "steps small");
    for (const step of [text.ios_step_share, text.ios_step_add, text.ios_step_open]) steps.appendChild(el(doc, "li", undefined, step));
    card.setContent(steps);
    card.setActions(button(doc, "btn", text.later, () => actions.later()));
    return;
  }
  if (mode === "topics") {
    card.setMessage(text.update_message);
    const list = topicList(doc, view.topics, (tag) => view.current[tag] === "1");
    card.setContent(list.node);
    card.setActions(button(doc, "btn", text.cancel, () => actions.later()), button(doc, "btn pri", text.save, () => actions.save(list.read())));
    return;
  }
  card.setMessage(text.message);
  if (view.topics.length > 0) {
    // New subscribers start with every topic; they untick what they do not want.
    const list = topicList(doc, view.topics, (tag) => view.current[tag] !== "0");
    card.setContent(list.node);
    card.setActions(button(doc, "btn", text.later, () => actions.later()), button(doc, "btn pri", text.allow, () => actions.allow(list.read())));
    return;
  }
  card.setContent();
  card.setActions(button(doc, "btn", text.later, () => actions.later()), button(doc, "btn pri", text.allow, () => actions.allow(undefined)));
}
