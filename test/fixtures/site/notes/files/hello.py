"""A file a note embeds."""


def greet(name: str) -> str:
    return f"howdy, {name}!"


def main() -> None:
    for name in ["basalt", "quartz", "you"]:
        print(greet(name))


if __name__ == "__main__":
    main()
