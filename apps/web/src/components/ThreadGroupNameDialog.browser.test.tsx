import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../test/render";
import { ThreadGroupIcon } from "./ThreadGroupIcon";
import { requestThreadGroupDetails, ThreadGroupNameDialogHost } from "./ThreadGroupNameDialog";

async function pngFile() {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#e11d48";
  context.fillRect(8, 8, 32, 32);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
  return new File([blob], "icon.png", { type: "image/png" });
}

describe("ThreadGroupNameDialog", () => {
  it("saves an uploaded image as the group's icon", async () => {
    await using _screen = await render(<ThreadGroupNameDialogHost />, { router: false });
    const result = requestThreadGroupDetails({
      title: "New group",
      submitLabel: "Create",
      initial: { name: "Docs", color: null, gradient: null, icon: null },
    });

    await userEvent.click(page.getByRole("button", { name: "Add icon" }));
    await userEvent.click(page.getByText("Image", { exact: true }));
    await userEvent.upload(page.getByLabelText("Image file"), await pngFile());
    await userEvent.click(page.getByRole("button", { name: "Save icon" }));
    await userEvent.click(page.getByRole("button", { name: "Create" }));

    expect(await result).toMatchObject({ name: "Docs", icon: { kind: "image" } });
  });
});

describe("ThreadGroupNameDialog gradient", () => {
  it("saves a gradient with its start color as the group color", async () => {
    await using _screen = await render(<ThreadGroupNameDialogHost />, { router: false });
    const result = requestThreadGroupDetails({
      title: "New group",
      submitLabel: "Create",
      initial: { name: "Docs", color: null, gradient: null, icon: null },
    });

    await userEvent.click(page.getByText("Gradient", { exact: true }));
    await userEvent.click(page.getByLabelText("Gradient start color").getByLabelText("Red"));
    await userEvent.click(page.getByLabelText("Gradient end color").getByLabelText("Teal"));
    await userEvent.click(page.getByRole("button", { name: "Create" }));

    expect(await result).toMatchObject({ color: "red", gradient: { from: "red", to: "teal" } });
  });
});

describe("ThreadGroupIcon", () => {
  it("shows an uploaded image", async () => {
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      void pngFile().then((file) => {
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
    });
    await using screen = await render(
      <ThreadGroupIcon group={{ color: null, icon: { kind: "image", dataUrl } }} />,
      { router: false },
    );
    const image = screen.container.querySelector("img")!;
    await vi.waitFor(() => expect(image.naturalWidth).toBeGreaterThan(0));
  });
});
