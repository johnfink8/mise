import { IconButton, Stack, Tooltip } from "@mui/material";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import ThumbDownIcon from "@mui/icons-material/ThumbDown";
import VisibilityIcon from "@mui/icons-material/Visibility";

import type { FeedbackStatus } from "@/types";

interface Props {
  feedback: FeedbackStatus;
  onChange: (next: FeedbackStatus) => void;
  disabled?: boolean;
}

export function FeedbackButtons({ feedback, onChange, disabled }: Props) {
  const toggle = (target: FeedbackStatus) => {
    onChange(feedback === target ? "none" : target);
  };
  return (
    <Stack direction="row" spacing={0.5}>
      <Tooltip title="Good pick">
        <IconButton
          size="small"
          color={feedback === "up" ? "primary" : "default"}
          aria-label="thumbs up"
          aria-pressed={feedback === "up"}
          onClick={() => toggle("up")}
          disabled={disabled}
        >
          <ThumbUpIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Not for me">
        <IconButton
          size="small"
          color={feedback === "down" ? "primary" : "default"}
          aria-label="thumbs down"
          aria-pressed={feedback === "down"}
          onClick={() => toggle("down")}
          disabled={disabled}
        >
          <ThumbDownIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Watched">
        <IconButton
          size="small"
          color={feedback === "watched" ? "primary" : "default"}
          aria-label="watched"
          aria-pressed={feedback === "watched"}
          onClick={() => toggle("watched")}
          disabled={disabled}
        >
          <VisibilityIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}
