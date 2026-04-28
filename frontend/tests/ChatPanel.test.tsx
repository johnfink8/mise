import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatPanel } from "@/components/ChatPanel";

const baseProps = {
  isPending: false,
  isFollowUp: false,
};

describe("ChatPanel", () => {
  it("submits on Enter and clears the input", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ChatPanel {...baseProps} onSubmit={onSubmit} />);
    const input = screen.getByLabelText(/chat input/i) as HTMLTextAreaElement;
    await user.type(input, "feel-good comedy{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("feel-good comedy");
    expect(input.value).toBe("");
  });

  it("inserts a newline on Shift+Enter", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ChatPanel {...baseProps} onSubmit={onSubmit} />);
    const input = screen.getByLabelText(/chat input/i) as HTMLTextAreaElement;
    await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toContain("line one");
    expect(input.value).toContain("line two");
  });

  it("disables send while pending", () => {
    render(<ChatPanel {...baseProps} onSubmit={() => {}} isPending={true} />);
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("renders a single static placeholder when given a string", () => {
    render(
      <ChatPanel
        {...baseProps}
        onSubmit={() => {}}
        placeholder="more like the first pick"
      />,
    );
    expect(screen.getByText(/more like the first pick/i)).toBeInTheDocument();
  });
});

describe("ChatPanel placeholder cycling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rotates through a placeholder list while idle", () => {
    render(
      <ChatPanel
        {...baseProps}
        onSubmit={() => {}}
        placeholder={["alpha prompt", "beta prompt", "gamma prompt"]}
        cycleMs={1000}
      />,
    );
    expect(screen.getByText(/alpha prompt/i)).toBeInTheDocument();
    // First tick: fade out + swap.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByText(/beta prompt/i)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByText(/gamma prompt/i)).toBeInTheDocument();
  });
});
