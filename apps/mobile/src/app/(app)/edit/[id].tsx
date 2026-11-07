import { useLocalSearchParams } from "expo-router";
import { CharacterEditor } from "../../../components/CharacterEditor";

export default function Edit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CharacterEditor id={id} />;
}
