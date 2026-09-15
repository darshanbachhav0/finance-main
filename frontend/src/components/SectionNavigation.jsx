import { Children, useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function SectionNavigation({ children, className, ...props }) {
  const { t } = useLanguage();
  const links = Children.toArray(children);
  const signature = links.map(link => link.props.href).join("|");
  const [active, setActive] = useState("");
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.find(entry => entry.isIntersecting);
      if (visible) setActive(`#${visible.target.id}`);
    }, { rootMargin: "-10% 0px -65% 0px" });
    signature.split("|").forEach(href => { const element = document.getElementById(href.slice(1)); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, [signature]);
  function navigate(href) {
    const element = document.getElementById(href.slice(1));
    if (!element) return;
    const toggle = element.querySelector("button[aria-expanded='false']");
    if (toggle) toggle.click();
    if (element.tagName === "DETAILS") element.open = true;
    element.scrollIntoView({ block: "start" });
    setActive(href);
    history.replaceState(null, "", href);
  }
  return <nav {...props} className={`responsive-section-nav ${className || ""}`}>
    <label className="section-selector"><span>{t("Section")}</span><select value={active} onChange={event => navigate(event.target.value)}><option value="">{t("Go to section")}</option>{links.map(link => <option key={link.props.href} value={link.props.href}>{link.props.children}</option>)}</select></label>
    <div className="section-links">{links.map(link => <a key={link.props.href} href={link.props.href} aria-current={active === link.props.href ? "location" : undefined} onClick={event => { event.preventDefault(); navigate(link.props.href); }}>{link.props.children}</a>)}</div>
  </nav>;
}
