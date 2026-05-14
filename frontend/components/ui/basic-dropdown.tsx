"use client";

import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const ROTATION_ANGLE_OPEN = 180;
const DROPDOWN_OFFSET = 4;

export interface DropdownItem {
  icon?: React.ReactNode;
  id: string | number;
  label: string;
}

export interface BasicDropdownProps {
  className?: string;
  items: DropdownItem[];
  label: string;
  onChange?: (item: DropdownItem) => void;
  value?: string | number;
}

export default function BasicDropdown({
  label,
  items,
  onChange,
  className = "",
  value,
}: BasicDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<DropdownItem | null>(
    items.find((item) => item.id === value) || null
  );
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const shouldReduceMotion = useReducedMotion();

  // Sync with value prop
  useEffect(() => {
    if (value !== undefined) {
      const item = items.find((i) => i.id === value);
      if (item) setSelectedItem(item);
    }
  }, [value, items]);

  const handleItemSelect = (item: DropdownItem, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setSelectedItem(item);
    setIsOpen(false);
    onChange?.(item);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        isOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isOpen) {
        if (
          (event.key === "Enter" || event.key === " ") &&
          document.activeElement === buttonRef.current
        ) {
          event.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      if (event.key === "Escape") {
        setIsOpen(false);
        setFocusedIndex(-1);
        buttonRef.current?.focus();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setFocusedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
      } else if (event.key === "Enter" && focusedIndex >= 0) {
        event.preventDefault();
        const item = items[focusedIndex];
        if (item) {
          handleItemSelect(item);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, items, focusedIndex]);

  return (
    <div className={`relative w-full ${className}`} ref={dropdownRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={selectedItem ? `${label}: ${selectedItem.label}` : label}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-border bg-secondary/30 px-4 py-2 text-left text-sm font-medium text-foreground transition-all duration-300 hover:bg-secondary/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary focus:bg-primary/5 focus:shadow-[0_0_15px_rgba(216,173,135,0.15)]"
        id="dropdown-button"
        onClick={handleToggle}
        ref={buttonRef}
        type="button"
      >
        <span className="block truncate opacity-90">
          {selectedItem ? selectedItem.label : label}
        </span>
        <motion.div
          animate={{ rotate: isOpen ? ROTATION_ANGLE_OPEN : 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
          className="shrink-0"
        >
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            animate={
              shouldReduceMotion
                ? { opacity: 1 }
                : { opacity: 1, y: 0, scaleY: 1 }
            }
            className="absolute top-full left-0 z-50 mt-1 w-full origin-top rounded-xl border border-border bg-card shadow-2xl shadow-black/40 overflow-hidden"
            exit={
              shouldReduceMotion
                ? { opacity: 0 }
                : {
                    opacity: 0,
                    y: -10,
                    scaleY: 0.8,
                    transition: { duration: 0.15 },
                  }
            }
            initial={
              shouldReduceMotion
                ? { opacity: 1 }
                : { opacity: 0, y: -10, scaleY: 0.8 }
            }
            transition={
              shouldReduceMotion
                ? { duration: 0 }
                : { type: "spring", bounce: 0.1, duration: 0.25 }
            }
          >
            <ul
              aria-label="Dropdown options"
              className="py-1.5"
              id="dropdown-items"
            >
              {items.map((item, index) => (
                <li key={item.id} role="option" className="px-1.5">
                  <button
                    aria-label={item.label}
                    className={`flex min-h-[40px] w-full items-center px-3 py-2 text-left text-sm rounded-lg transition-all duration-200 hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none ${
                      selectedItem?.id === item.id
                        ? "bg-primary/5 font-semibold text-primary"
                        : "text-foreground/80"
                    } ${index === focusedIndex ? "bg-primary/5" : ""}`}
                    onClick={(e) => handleItemSelect(item, e)}
                    onMouseEnter={() => setFocusedIndex(index)}
                    type="button"
                  >
                    {item.icon && (
                      <span className="mr-2 text-lg shrink-0">{item.icon}</span>
                    )}
                    <span className="truncate">{item.label}</span>

                    {selectedItem?.id === item.id && (
                      <motion.span
                        animate={shouldReduceMotion ? {} : { scale: 1 }}
                        className="ml-auto shrink-0"
                        initial={shouldReduceMotion ? {} : { scale: 0 }}
                        transition={
                          shouldReduceMotion
                            ? { duration: 0 }
                            : {
                                type: "spring",
                                stiffness: 300,
                                damping: 20,
                                duration: 0.2,
                              }
                        }
                      >
                        <svg
                          className="h-3.5 w-3.5 text-primary"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <title>Selected</title>
                          <path
                            d="M5 13l4 4L19 7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                          />
                        </svg>
                      </motion.span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
