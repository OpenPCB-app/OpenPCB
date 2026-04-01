import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LibraryScreen } from "./LibraryScreen";

describe("LibraryScreen", () => {
  it("shows only Ground and Resistor cards without fake procurement metadata", () => {
    render(<LibraryScreen />);

    expect(screen.getByText("Ground")).toBeInTheDocument();
    expect(screen.getByText("Resistor")).toBeInTheDocument();
    expect(screen.queryByText("ESP32-S3")).not.toBeInTheDocument();
    expect(screen.queryByText("USB-C Connector")).not.toBeInTheDocument();
    expect(screen.queryByText("$0.002")).not.toBeInTheDocument();
    expect(screen.queryByText("45K")).not.toBeInTheDocument();
  });

  it("filters the built-in list by search query", () => {
    render(<LibraryScreen />);

    fireEvent.change(screen.getByPlaceholderText("Search components..."), {
      target: { value: "ground" },
    });

    expect(screen.getByText("Ground")).toBeInTheDocument();
    expect(screen.queryByText("Resistor")).not.toBeInTheDocument();
  });
});
