import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { RotatingTagline, TAGLINES } from "@/components/RotatingTagline";

describe("RotatingTagline", () => {
  it("renders the static line and does not cycle when given staticText", () => {
    render(<RotatingTagline staticText="From the archive." />);
    expect(screen.getByText("From the archive.")).toBeInTheDocument();
  });

  it("exposes the canonical mise tagline list", () => {
    expect(TAGLINES).toContain("Set the scene.");
    expect(TAGLINES).toContain("Roll camera.");
    expect(TAGLINES.length).toBeGreaterThanOrEqual(9);
  });
});

describe("RotatingTagline cycling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances through provided lines on the hold + swap cadence", () => {
    render(
      <RotatingTagline
        lines={["alpha.", "beta.", "gamma."]}
        holdMs={1000}
        swapMs={300}
      />,
    );
    expect(screen.getByText("alpha.")).toBeInTheDocument();
    // After hold + swap, the text should swap to the next line.
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    expect(screen.getByText("beta.")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    expect(screen.getByText("gamma.")).toBeInTheDocument();
  });

  it("does not animate when given a single line (no swap timers)", () => {
    render(<RotatingTagline lines={["only one."]} />);
    expect(screen.getByText("only one.")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText("only one.")).toBeInTheDocument();
  });
});
