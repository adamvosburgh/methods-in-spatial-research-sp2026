---
title: "How to Submit Your Final Project"
date: "2026-01-01"
author: Adam Vosburgh
sequence: 14
cat: tutorial
published: true
---

This tutorial explains how to submit your final project to the course website. You will upload your files directly through the GitHub website — no command line or local software required.

Your submission consists of two parts:
1. A markdown file (`.md`) with your project text
2. Your images, uploaded to a folder named for your group

---

## 01. Get access to the repository

You will need a GitHub account to contribute to the course repository. It is probably most straightforward to delegate one person in your group to do this.

1. Create a free account at [github.com](https://github.com) if you don't already have one.
2. Send your GitHub username to me. You will be added as a collaborator on the repository.
3. Once added, you'll receive an email invitation. Accept it.

---

## 02. Download and edit the template

The template file is located in the course repository at `src/projects/2026-01-01-lastname-firstname.md`.

1. Go to the [course repository on GitHub.](https://github.com/adamvosburgh/methods-in-spatial-research-sp2026)
2. Navigate to `src/projects/`.
3. Click on `2026-01-01-lastname-firstname.md`.
4. Click the download icon (or copy the raw text) to save a local copy.

**Rename the file** using the format `2026-01-01-lastname-firstname.md`, substituting one group member's last and first name. For example: `2026-01-01-smith-jane.md`.

Open the file in a plain text editor (TextEdit on Mac, Notepad on Windows, or a fancier one like [VS Code](https://code.visualstudio.com/) for a better experience).

### Edit the frontmatter

At the top of the file you will see a block like this:

```
---
date: 2026-01-01
image: "/projects/images/lastname-firstname/cover.jpg"
title: "Template Post: Title of Your Final Project"
author: "Names Of Everyone In Your Group"
published: true
---
```

Replace each field with your own information:
- `date`: use today's date in `YYYY-MM-DD` format
- `image`: the path to your cover image (see section 04 below)
- `title`: your project title
- `author`: all group members' names

### Write your content

Below the frontmatter, replace the template text with your project content. The template includes a markdown cheat sheet — refer to it as you write.

---

## 03. Prepare your images

All images must be at least 740 pixels wide, but I recommend keeping them below 2-3mb each. If they are more than that, they will take time to load on the browser. 
Rename your image files clearly (e.g., `01-overview-map.jpg`, `02-site-photo.jpg`).

Create a folder on your computer named for your group (same as your `.md` filename without the date, e.g., `smith-jane`). Place all your images inside it. You will not actually need this folder later — you'll be uploading the images on their own — this is just to keep things organized.

One of your images should serve as the **cover image** for the project index. Name it `cover.jpg` (or `cover.png`).

---

## 04. Upload your images to GitHub

1. Go to the course repository on GitHub.
2. Navigate to `src/projects/images/`.
3. Click **Add file** → **Upload files**.
4. Before dragging in your images, you need to create a subfolder. In the upload area, you'll see a text field showing the path. Type your group folder name followed by a `/` to create the folder — for example, type `smith-jane/` — then drag your image files into the upload area.
5. Scroll down to the **Commit changes** section. Add a brief message like `add images for smith-jane project`.
6. Click **Commit changes**.

Your images are now uploaded. The path to your cover image will be:

```
/projects/images/lastname-firstname/cover.jpg
```

Make sure this matches the `image:` field in your frontmatter.

---

## 05. Upload your markdown file to GitHub

1. In the repository, navigate to `src/projects/`.
2. Click **Add file** → **Upload files**.
3. Drag your `.md` file into the upload area.
4. Add a commit message like `add smith-jane final project`.
5. Click **Commit changes**.

---

## 06. Check your post

After uploading, GitHub Actions will rebuild the site automatically. Wait 1–2 minutes, then visit the course website and click **Student Work** in the navigation bar. Your project should appear in the grid.

If it does not appear, check the following:
- The `published: true` field is in your frontmatter
- Your file is saved with a `.md` extension
- The `image:` path matches the actual file path in the repository (case-sensitive)

To make corrections, simply re-upload your `.md` file with the same filename. GitHub will replace the previous version.

---

## Markdown quick reference

```
#### Section heading (use level 4)

**bold text**

*italic text*

[link text](https://example.com)

![image description](/projects/images/your-group/image.jpg)

- bullet list item
- another item

1. numbered list
1. another item
```

For interactive maps or iframes, use this wrapper so the embed is responsive:

```html
<div class="iframe-column">
  <iframe src="YOUR-URL-HERE" style="position:absolute;top:0;left:0;width:100%;height:100%;" frameborder="0"></iframe>
</div>
```

---

## Questions?

Feel free to schedule office hours ahead of time if you run into anything.
